import mongoose from 'mongoose';
import Campaign from '../models/Campaign.js';
import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import CVVersion from '../models/CVVersion.js';
import SearchPreference from '../models/SearchPreference.js';
import User from '../models/User.js';
import { tailorCv, scoreOffer } from './tailoringService.js';
import { botApply, botConfigured, renderCvPdf } from './botService.js';
import { buildTailoredCvHtml } from './cvDocument.js';
import { tryRevive } from './sessionRevival.js';
import { reconcilier } from './reconciliation.js';
import { journaliser } from './activityLog.js';
import { enregistrerQuestions, reponsesPour } from './applyKnowledge.js';
import { appliquerResultat } from './applyOutcome.js';
import { deviner } from '../utils/applyFailure.js';
import { BOT_PLATFORMS } from '../utils/constants.js';

/**
 * Ce que chaque plateforme a réellement produit pour ce compte.
 *
 * Sert à décider où placer le quota de la prochaine passe. On ne compte que les
 * candidatures effectivement *tentées* : un brouillon ou une offre en attente
 * ne dit rien de la capacité d'une plateforme à recevoir un envoi.
 *
 * Le calcul se lit dans les candidatures existantes plutôt que dans un compteur
 * tenu à part : un compteur dérive dès qu'une candidature est supprimée ou
 * corrigée à la main, et il faudrait le réconcilier. Ici, la source de vérité
 * est la seule qui compte — ce que la base dit être arrivé.
 */
const TENTEES = ['postule', 'echec_envoi', 'a_verifier'];

async function rendementParSource(user) {
  /*
   * `aggregate` ne convertit pas les identifiants, contrairement à `find`.
   *
   * Les deux appelants passent une chaîne (`req.user.id`, `campaign.user
   * .toString()`). Le schéma la transforme en ObjectId pour une requête
   * ordinaire, mais un pipeline part tel quel vers MongoDB : un `$match` sur la
   * chaîne n'aurait jamais rien trouvé, la mesure serait restée vide, et la
   * redistribution ne se serait jamais déclenchée — sans la moindre erreur.
   */
  const proprietaire =
    typeof user === 'string' ? new mongoose.Types.ObjectId(user) : user;

  const lignes = await Application.aggregate([
    { $match: { user: proprietaire, status: { $in: TENTEES } } },
    { $lookup: { from: 'joboffers', localField: 'offer', foreignField: '_id', as: 'o' } },
    { $unwind: '$o' },
    {
      $group: {
        _id: '$o.source',
        essais: { $sum: 1 },
        succes: { $sum: { $cond: [{ $eq: ['$status', 'postule'] }, 1, 0] } },
      },
    },
  ]);

  return new Map(lignes.map((l) => [l._id, { essais: l.essais, succes: l.succes }]));
}

/**
 * Une passe de campagne automatique.
 *
 * Le déroulé est volontairement conservateur : on ne postule qu'à ce qui a été
 * scoré au-dessus du seuil, dans la limite du quota, et — sauf mode « envoyer »
 * explicite — on s'arrête au brouillon relu par un humain.
 *
 * La fonction ne lève jamais : une campagne qui échoue doit laisser une trace
 * lisible dans la page, pas faire tomber le planificateur.
 */
/**
 * Le dossier « classique » : le CV de référence, sans passer par le modèle.
 *
 * Sert deux cas — le mode choisi explicitement, et le repli quand le moteur est
 * indisponible. La lettre reste volontairement sobre : sans modèle pour la
 * rédiger, mieux vaut trois phrases justes qu'un texte générique enflé.
 */
function dossierClassique(profile, score) {
  // `masterCvHtml` est le document de l'onglet « Mon CV », enregistré tel qu'il
  // s'imprime. `masterCv` (texte libre) n'est qu'un repli : il ne porte ni la
  // mise en page ni les rubriques, et donnait un PDF méconnaissable.
  const nom = profile.fullName || '';
  const contact = [profile.email, profile.phone].filter(Boolean).join(' · ');

  return {
    content: profile.masterCv || '',
    coverLetter: [
      'Madame, Monsieur,',
      '',
      "Votre annonce a retenu mon attention et je vous adresse ma candidature.",
      'Vous trouverez mon parcours détaillé dans le CV joint.',
      '',
      'Je reste disponible pour en échanger.',
      '',
      'Cordialement,',
      '',
      nom,
      contact,
    ]
      .filter((ligne) => ligne !== undefined)
      .join('\n')
      .trim(),
    score: typeof score === 'number' ? score : 0,
    keywords: [],
  };
}

export async function runCampaign({ user, trigger = 'planifié', dryRun = false } = {}) {
  if (!user) throw new Error("runCampaign : utilisateur manquant.");
  const campaign = await Campaign.forUser(user);

  // Deux exécutions ne doivent pas se chevaucher : une recherche multi-sources
  // peut durer plusieurs minutes, bien plus que l'intervalle le plus court.
  if (campaign.running) {
    return { skipped: 'une exécution est déjà en cours' };
  }

  const { left } = campaign.remainingToday();
  if (left <= 0) {
    return { skipped: `quota quotidien atteint (${campaign.dailyLimit})` };
  }

  campaign.running = true;
  campaign.lastRunAt = new Date();
  await campaign.save();

  const summary = {
    trigger,
    dryRun,
    examined: 0,
    prepared: 0,
    sent: 0,
    manual: 0,
    belowScore: 0,
    // Essais concluants : formulaire rempli, envoi volontairement retenu.
    ready: 0,
    errors: [],
  };

  try {
    /*
     * Le compte sert de repli à l identite du profil : nom et adresse y sont
     * toujours renseignes, alors que le profil peut ne pas l etre. Une
     * candidature sans nom ni adresse part quand meme, et arrive anonyme.
     */
    const [profile, prefs, compte] = await Promise.all([
      Profile.forUser(user).then((p) =>
        Profile.findById(p._id).select("+masterCvHtml +cvFile")
      ),
      SearchPreference.forUser(user),
      User.findById(user).select("fullName email").lean(),
    ]);

    /*
     * Une offre déjà suivie n'est jamais re-candidatée. Aucune exception.
     *
     * J'avais un temps repêché les envois marqués en échec, en pensant qu'ils
     * n'étaient jamais partis. C'était faux : un « échec » signifie seulement
     * qu'on n'a pas *vu* de confirmation — la candidature, elle, pouvait très
     * bien être arrivée chez le recruteur. Le rattrapage a donc produit de
     * vraies doubles candidatures sur la même offre.
     *
     * L'existence d'une candidature suffit à écarter l'offre, quel que soit son
     * statut. Une candidature à reprendre se termine à la main, depuis sa fiche.
     */
    /*
     * L identite qui accompagne chaque candidature, construite une fois.
     *
     * Le telephone n est pas facultatif : la candidature simplifiee de LinkedIn
     * en fait un champ obligatoire des son premier ecran, et sans lui le
     * parcours s arrete la, sur toutes les offres. On le dit franchement dans
     * le bilan plutot que de laisser la campagne echouer sans motif lisible.
     */
    const nomComplet = profile.fullName || compte?.fullName || "";
    const identite = {
      firstName: nomComplet.split(" ")[0] || "",
      lastName: nomComplet.split(" ").slice(1).join(" ") || "",
      email: profile.email || compte?.email || "",
      phone: profile.phone || "",
    };
    if (!identite.phone) {
      summary.errors.push(
        "Telephone absent du profil : LinkedIn refuse sa candidature simplifiee sans numero. " +
          "A renseigner dans l onglet « Mon CV »."
      );
    }

    const known = await Application.find({ user }).distinct('offer');

    const baseFilter = { _id: { $nin: known }, user };
    /*
     * Les filtres de la campagne priment sur ceux de la recherche.
     *
     * On explore large dans l’onglet Offres et on candidate étroit en campagne :
     * hériter des mêmes critères empêchait de viser les CDI en télétravail sans
     * restreindre du même coup toute la collecte.
     */
    const contrats = campaign.contractTypes?.length ? campaign.contractTypes : prefs.contractTypes;
    const modes = campaign.remotes?.length ? campaign.remotes : prefs.remotes;
    if (contrats?.length) baseFilter.contractType = { $in: contrats };
    if (modes?.length) baseFilter.remote = { $in: modes };

    /*
     * Fraîcheur : la campagne vise en priorité les annonces récentes.
     *
     * Une offre sans date connue reste éligible (repli sur la date de collecte) :
     * l'écarter reviendrait à ignorer des sources entières qui ne datent pas
     * leurs annonces.
     */
    const UNITES_MS = {
      minute: 60_000,
      heure: 3_600_000,
      jour: 86_400_000,
      semaine: 604_800_000,
      mois: 2_592_000_000,
    };
    if (campaign.maxAgeValue > 0) {
      const plancher = new Date(
        Date.now() - campaign.maxAgeValue * (UNITES_MS[campaign.maxAgeUnit] || UNITES_MS.jour)
      );
      baseFilter.$or = [
        { publishedAt: { $gte: plancher } },
        { publishedAt: null, createdAt: { $gte: plancher } },
      ];
    }

    // Concurrence : contrairement au filtre de la page Offres, on garde ici les
    // offres au compteur inconnu — sinon la campagne se priverait de presque
    // tout, peu de plateformes exposant ce chiffre.
    if (Number.isFinite(campaign.maxApplicants)) {
      baseFilter.$and = [
        ...(baseFilter.$and || []),
        { $or: [{ applicantCount: null }, { applicantCount: { $lte: campaign.maxApplicants } }] },
      ];
    }

    // Une file par source, chacune avec son propre quota. On part des offres
    // déjà en base : la synchronisation est un geste séparé, pour que la
    // campagne reste rapide et prévisible.
    const wanted = (campaign.targets || []).filter((target) => target.limit > 0);
    if (!wanted.length) {
      campaign.lastResult = 'Aucune source activée : rien à faire.';
      return { ...summary, skipped: 'aucune source activée' };
    }

    let budget = left;
    const candidates = [];

    /*
     * Le quota va là où les candidatures aboutissent.
     *
     * Constaté en éprouvant les plateformes sur des annonces réelles : l'APEC
     * refuse le navigateur piloté sur *toutes* ses annonces (six sur six, son
     * anti-bot répond 403 sur le détail de l'offre), et Welcome to the Jungle
     * n'héberge que trois candidatures sur dix-huit — les autres renvoient vers
     * l'ATS de l'employeur. Sans mémoire, la campagne redépensait le même quota
     * sur les mêmes murs à chaque passage, avec de nouvelles annonces : à
     * trente secondes l'essai sur l'APEC, l'essentiel du budget se perdait là.
     *
     * On regarde donc ce que chaque source a réellement produit pour ce compte,
     * et on déplace le quota vers celles qui aboutissent.
     */
    const rendement = await rendementParSource(user);

    // Une source sans le moindre succès garde une place : jamais zéro.
    //
    // Les plateformes changent — un anti-bot se lève, une refonte rouvre un
    // formulaire. Condamner définitivement une source sur son passé, c'est
    // s'interdire de le remarquer. Une annonce par passage suffit à le voir.
    const SONDE = 1;
    const ESSAIS_MINI = 8; // en dessous, l'échantillon ne prouve rien

    const ajuste = wanted.map((target) => {
      const stat = rendement.get(target.source) || { essais: 0, succes: 0 };
      const condamnee = stat.essais >= ESSAIS_MINI && stat.succes === 0;
      return {
        target,
        stat,
        limite: condamnee ? Math.min(SONDE, target.limit) : target.limit,
        condamnee,
      };
    });

    // Ce que les sources en échec libèrent revient à celles qui aboutissent.
    const libere = ajuste.reduce((somme, a) => somme + (a.target.limit - a.limite), 0);
    const productives = ajuste.filter((a) => !a.condamnee);
    if (libere > 0 && productives.length) {
      const part = Math.floor(libere / productives.length);
      const reste = libere - part * productives.length;
      productives.forEach((a, i) => {
        a.limite += part + (i < reste ? 1 : 0);
      });
      summary.errors.push(
        `Quota redistribué : ${libere} place(s) reprise(s) à ${ajuste
          .filter((a) => a.condamnee)
          .map((a) => `${a.target.source} (0/${a.stat.essais})`)
          .join(', ')}.`
      );
    }

    for (const { target, limite } of ajuste) {
      if (budget <= 0 || limite <= 0) continue;
      const take = Math.min(limite, budget);
      /*
       * On écarte ce qu'on sait ne pas pouvoir envoyer.
       *
       * `applyMode` est appris au fil des essais : une annonce dont on a déjà
       * constaté qu'elle renvoie ailleurs, ou que la plateforme protège, ne
       * mérite pas qu'on y repasse. Les `inconnu` et les absents (annonces
       * collectées avant ce champ) restent éligibles.
       */
      const pool = await JobOffer.find({
        ...baseFilter,
        source: target.source,
        applyMode: { $nin: ['externe', 'bloque'] },
      })
        // Les plus fraîches d abord : à quota égal, autant viser les récentes.
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(take * 6);
      candidates.push({ source: target.source, quota: take, pool });
      budget -= take;
    }

    summary.perSource = {};

    /*
     * Une même annonce republiée ne se paie pas deux fois.
     *
     * Les agrégateurs republient : « Développeur Java Fullstack F/H » chez le
     * même employeur revient sous plusieurs identifiants, parfois via plusieurs
     * sources. Chacun déclenchait sa propre génération — deux CV facturés pour
     * un seul poste. On dédoublonne sur intitulé + employeur, le temps de la
     * passe : deux vraies offres homonymes chez le même employeur sont bien plus
     * rares qu'une republication.
     */
    const vues = new Set();
    const empreinte = (offer) =>
      `${(offer.title || '').trim().toLowerCase()}|${(offer.company || '').trim().toLowerCase()}`;

    for (const { source, quota, pool } of candidates) {
      let done = 0;
      summary.perSource[source] = { prepared: 0, sent: 0, manual: 0, belowScore: 0 };

      for (const offer of pool) {
        if (done >= quota) break;
        if (summary.prepared + summary.sent >= left) break;

        const cle = empreinte(offer);
        if (cle !== '|' && vues.has(cle)) continue;
        vues.add(cle);
        summary.examined += 1;

        try {
          /*
           * Filtrer AVANT de générer.
           *
           * Le score est déterministe et se calcule en quelques millisecondes,
           * sans modèle. On l'obtenait pourtant en générant d'abord le CV
           * complet, pour jeter le résultat quand il tombait sous le seuil :
           * une passe de 36 offres toutes sous le seuil payait 36 générations
           * Opus pour n'en garder aucune, et durait une vingtaine de minutes.
           *
           * Sans moteur configuré, `scoreOffer` rend `null` : on ne filtre pas
           * plutôt que de rejeter sur un score inventé.
           */
          const prefiltre = await scoreOffer({ offer, profile });
          if (prefiltre !== null && prefiltre < campaign.minScore) {
            summary.belowScore += 1;
            summary.perSource[source].belowScore += 1;
            continue;
          }

          /*
           * Adaptatif ou classique — et repli automatique.
           *
           * En `classique`, on joint le CV de l'onglet « Mon CV » sans appeler
           * le modèle : gratuit, instantané, et suffisant quand on postule en
           * volume sur un même métier.
           *
           * En `adaptatif`, si le moteur lâche (crédits épuisés, panne), on
           * bascule sur ce même CV plutôt que d'abandonner la candidature :
           * un dossier parti avec le CV de référence vaut mieux qu'un dossier
           * qui ne part pas.
           */
          let result;
          let cvClassique = campaign.cvMode === 'classique';

          if (cvClassique) {
            result = dossierClassique(profile, prefiltre);
          } else {
            try {
              result = await tailorCv({ offer, profile });
            } catch (aiError) {
              if (!profile.masterCv?.trim()) throw aiError;
              cvClassique = true;
              result = dossierClassique(profile, prefiltre);
              summary.errors.push(
                `IA indisponible (${aiError.message}) — CV de référence utilisé.`
              );
            }
          }

          const score = typeof result.score === 'number' ? result.score : 0;

          // Le score définitif peut différer de la présélection (le moteur voit
          // le CV reciblé) : on revérifie, sans payer deux fois pour autant.
          if (score < campaign.minScore) {
            summary.belowScore += 1;
            summary.perSource[source].belowScore += 1;
            continue;
          }

          const at = offer.company ? ` @ ${offer.company}` : '';
          const cv = await CVVersion.create({
            user,
            // Le libellé dit d'où vient le document : un CV de référence joint
            // tel quel ne doit pas se faire passer pour un CV reciblé.
            label: `${cvClassique ? 'CV de référence' : 'CV'} — ${offer.title}${at}`,
            kind: 'cible',
            offer: offer._id,
            content: result.content,
            score,
          });

          /*
           * Le CV reciblé devient un PDF ici, pas plus tard.
           *
           * C'est la pièce qu'on joindra au formulaire : sans elle, la
           * candidature partirait sans CV — ce qui était exactement le défaut
           * de la version précédente, où l'envoi ne recevait jamais de fichier.
           */
          let cvPdf = null;
          try {
            let buffer;

            if (cvClassique) {
              /*
               * Mode classique : on joint le document de l'onglet « Mon CV »,
               * jamais une recomposition.
               *
               * Deux formes possibles — le fichier importé tel quel, ou le CV
               * composé enregistré à sa dernière sauvegarde. Si aucune n'existe,
               * on s'arrête : recomposer depuis le texte extrait produisait un
               * PDF méconnaissable que la personne découvrait chez le recruteur.
               * Mieux vaut une candidature non partie qu'un mauvais CV parti.
               */
              /*
               * `cvMode` tranche, et l'aperçu montre la même chose.
               *
               * Le fichier importé l'emportait auparavant dès qu'il existait :
               * un import remplaçait donc en silence le CV composé au moment de
               * candidater, pendant que l'écran continuait d'afficher le
               * composé. On envoyait un document que personne n'avait vu.
               */
              const prefereImporte = profile.cvMode === 'importe';

              if (prefereImporte && profile.cvFile?.length) {
                // Le fichier d'origine : aucune réimpression, rien à dégrader.
                buffer = profile.cvFile;
              } else if (profile.masterCvHtml) {
                ({ buffer } = await renderCvPdf(profile.masterCvHtml));
              } else if (profile.cvFile?.length) {
                // Mode « composé » mais rien de composé à ce jour : le fichier
                // importé vaut mieux qu'une candidature qui ne part pas.
                buffer = profile.cvFile;
              } else {
                throw new Error(
                  "Mode « CV classique » : aucun CV dans l'onglet « Mon CV ». " +
                    'Ouvre-le et enregistre une fois, ou importe un fichier.'
                );
              }
            } else {
              ({ buffer } = await renderCvPdf(
                buildTailoredCvHtml(result.content, { accent: profile.cvOptions?.accent })
              ));
            }

            cvPdf = buffer;
            cv.pdf = buffer;
            cv.pdfBytes = buffer.length;
            await cv.save();
          } catch (pdfError) {
            // Sans PDF on peut encore préparer la candidature ; on ne l'enverra
            // simplement pas à l'aveugle, et la raison est écrite.
            summary.errors.push(`${source} : CV non imprimé (${pdfError.message})`);
          }

          /*
           * Dernier verrou avant d'engager quoi que ce soit.
           *
           * La liste des offres écartées a été lue au début de la passe : une
           * candidature créée entre-temps — autre passe, geste manuel — n'y
           * figure pas. L'index unique en base rejetterait le doublon, mais on
           * s'arrête avant, pour ne pas envoyer un formulaire qu'on ne pourrait
           * de toute façon pas enregistrer.
           */
          if (await Application.exists({ user, offer: offer._id })) {
            continue;
          }

          const application = await Application.create({
            user,
            offer: offer._id,
            status: 'a_postuler',
            cvVersion: cv._id,
            coverLetter: result.coverLetter,
            matchScore: score,
            notes: `Préparée automatiquement (campagne ${trigger}).`,
          });

          done += 1;

          /*
           * Pourquoi on n'essaie pas d'envoyer — et non un simple « non ».
           *
           * Une candidature qui reste éternellement en « à postuler » sans que
           * rien n'explique pourquoi est le pire des deux mondes : le travail
           * est fait, l'utilisateur ne sait pas ce qui manque. On écrit donc la
           * raison dans le fil, là où elle se lit.
           */
          const blocage =
            campaign.mode !== 'envoyer'
              ? 'La campagne est en mode « préparer seulement » : bascule-la sur « envoyer » pour que les candidatures partent.'
              : !botConfigured()
                ? "Le navigateur piloté n'est pas configuré (BOT_URL absent) : aucun envoi possible."
                : !BOT_PLATFORMS.includes(source)
                  ? `${source} ne reçoit pas de candidature automatisée : l'annonce renvoie vers un site tiers.`
                  : !cvPdf
                    ? "Le CV n'a pas pu être imprimé en PDF : on n'envoie pas de candidature sans pièce jointe."
                    : null;

          if (blocage) {
            application.timeline.push({ status: 'a_postuler', note: blocage });
            summary.prepared += 1;
            summary.perSource[source].prepared += 1;
            await application.save();
            continue;
          }

          /*
           * L'envoi a son propre filet.
           *
           * Une session fermée ou un formulaire inattendu ne doit pas effacer le
           * travail déjà fait : la candidature est préparée, elle reste en
           * « à postuler » avec la raison écrite dessus, et elle compte dans le
           * bilan. Sans cette séparation, une erreur d'envoi faisait disparaître
           * du résumé une candidature pourtant bien créée.
           */
          try {
            // Les réponses de cette plateforme, relues une fois par offre : la
            // personne peut en avoir ajouté depuis le début de la passe.
            const reponses = await reponsesPour(user, source).catch(() => ({}));

            // Le PDF voyage avec la demande : le bot n'a aucun fichier à aller
            // chercher, et les deux services n'ont pas de disque en commun.
            const envoyer = () =>
              botApply(source, offer, {
              filename: `CV-${(profile.fullName || 'candidat').replace(/\s+/g, '-')}.pdf`,
              content: cvPdf.toString('base64'),
            }, user, {
              /*
               * L'identité du candidat, telle que les formulaires la réclament.
               *
               * Le téléphone manquait, et ce n'est pas un détail : la
               * candidature simplifiée de LinkedIn en fait un champ obligatoire
               * dès son premier écran. Sans lui, le parcours s'arrêtait là,
               * chaque fois, sur toutes les offres.
               *
               * Le nom du compte sert de repli à celui du profil : un profil
               * incomplet faisait partir des candidatures sans nom ni adresse,
               * ce qui est pire qu'un échec — le recruteur reçoit un dossier
               * anonyme.
               */
              applicant: identite,
              coverLetter: result.coverLetter || "",
              dryRun,
              /*
               * Ce que la personne a déjà répondu aux questions de cette
               * plateforme. C'est ce qui fait qu'une question posée une fois ne
               * bloque plus : sans ces réponses, chaque annonce réclamant
               * « Années d'expérience » échouerait indéfiniment, la même
               * information manquant à chaque passage.
               */
              answers: reponses,
            });

            /*
             * Session expirée : on la rouvre une fois, puis on réessaie.
             *
             * Le bot répond 409 quand aucune session n'est ouverte. Les
             * identifiants étant déjà enregistrés et chiffrés, laisser la
             * candidature échouer obligeait à rouvrir l'onglet Comptes pour un
             * clic que le serveur peut faire lui-même — France Travail expirant
             * plus vite que les autres, c'était le cas le plus fréquent.
             *
             * Une seule tentative : insister sur une plateforme qui réclame une
             * vérification à deux facteurs ne la ferait pas céder, et
             * déclencherait surtout des alertes de sécurité sur le compte.
             */
            let outcome;
            try {
              outcome = await envoyer();
            } catch (sessionError) {
              if (sessionError.status !== 409) throw sessionError;
              if (!(await tryRevive(source, user))) throw sessionError;
              summary.errors.push(`${source} : session expirée, rouverte automatiquement.`);
              outcome = await envoyer();
            }

            /*
             * La qualification est partagée avec la reprise manuelle.
             *
             * Décider si une candidature compte comme partie est le point où
             * une erreur coûte le plus : soit un double envoi, soit un dossier
             * perdu qu'on croit arrivé. Deux copies de cette chaîne auraient
             * fini par diverger — et la divergence aurait porté exactement là.
             */
            const bilan = appliquerResultat(application, outcome, {
              platform: source,
              note: 'Envoyée par la campagne, CV reciblé joint.',
            });

            if (bilan.offerPatch) {
              // La leçon s'écrit sur l'offre : ni cette passe ni les suivantes
              // n'y regoûtent, et l'adresse du recruteur reste sous la main.
              await JobOffer.updateOne({ _id: offer._id }, { $set: bilan.offerPatch }).catch(() => {});
            }
            await enregistrerQuestions(bilan.questions, {
              user,
              platform: source,
              offer: offer._id,
            });

            if (bilan.categorie === 'sent') {
              cv.sentAt = new Date();
              await cv.save();
              summary.sent += 1;
              summary.perSource[source].sent += 1;
            } else if (bilan.categorie === 'ready') {
              summary.ready += 1;
            } else {
              summary.manual += 1;
              summary.perSource[source].manual += 1;
            }
          } catch (sendError) {
            application.status = 'echec_envoi';
            application.notes += ` — envoi impossible : ${sendError.message}`;
            application.timeline.push({ status: 'echec_envoi', note: sendError.message });
            /*
             * Une exception n'a pas de code : on le déduit du message, ce qui
             * range aussi les incidents réseau. Le 409 est le seul cas où le
             * transport dit lui-même de quoi il s'agit — une session fermée.
             */
            application.lastFailure = {
              reason: sendError.status === 409 ? 'session_expiree' : deviner(sendError.message),
              message: sendError.message,
              platform: source,
              at: new Date(),
              fields: [],
            };
            summary.prepared += 1;
            summary.perSource[source].prepared += 1;
            summary.errors.push(`${source} : ${sendError.message}`);
          }

          await application.save();
        } catch (error) {
          // Une offre qui échoue ne doit pas emporter la passe entière.
          summary.errors.push(`${source} · ${offer.title?.slice(0, 32)} : ${error.message}`);
        }
      }
    }

    const total = summary.prepared + summary.sent;
    if (total > 0) campaign.consume(total);

    // Le détail par source est ce qui permet de voir qu'une plateforme
    // n'envoie jamais — un total agrégé le masquerait.
    const detail = Object.entries(summary.perSource)
      .filter(([, counts]) => counts.prepared || counts.sent || counts.manual)
      .map(([name, counts]) => {
        const bits = [
          counts.sent && `${counts.sent} envoyée(s)`,
          counts.prepared && `${counts.prepared} préparée(s)`,
          counts.manual && `${counts.manual} à finir`,
        ].filter(Boolean);
        return `${name} : ${bits.join(', ')}`;
      });

    /*
     * Dernière étape : demander aux plateformes ce qu'elles ont réellement reçu.
     *
     * Une confirmation ne s'affiche pas toujours au moment de l'envoi, et le
     * robot ne peut conclure que sur ce qu'il voit. Beaucoup de candidatures
     * bien arrivées restaient donc en « à vérifier » ou « envoi échoué ». La
     * plateforme, elle, sait : on lui demande, juste après avoir envoyé.
     *
     * Un échec ici ne remet rien en cause — les candidatures gardent le statut
     * que l'envoi leur a donné, simplement sans la promotion.
     */
    let confirmees = 0;
    if (!dryRun) {
      try {
        const bilan = await reconcilier(user);
        confirmees = bilan.confirmed || 0;
        summary.confirmed = confirmees;
      } catch (error) {
        summary.errors.push(`Rapprochement impossible : ${error.message}`);
      }
    }

    campaign.lastResult =
      `${summary.examined} offre(s) examinée(s)` +
      (detail.length ? ` — ${detail.join(' · ')}` : ' — aucune retenue') +
      (summary.belowScore ? ` · ${summary.belowScore} sous le seuil` : '') +
      (confirmees ? ` · ${confirmees} confirmée(s) par la plateforme` : '');
    campaign.lastError = summary.errors.slice(0, 3).join(' | ');
  } catch (error) {
    campaign.lastError = error.message;
    summary.errors.push(error.message);
  } finally {
    campaign.running = false;
    await campaign.save();

    /*
     * Trace de la passe.
     *
     * `campaign` ne porte qu'un `lastResult`, écrasé à la suivante : sans cette
     * ligne, une campagne qui échoue une nuit sur deux est indiscernable d'une
     * campagne qui vient d'échouer pour la première fois. Écrit dans le `finally`
     * pour couvrir aussi les passes interrompues par une erreur.
     */
    await journaliser(user, 'campagne.execution', {
      at: campaign.lastRunAt,
      severity: summary.errors.length ? 'erreur' : 'succes',
      summary: campaign.lastError
        ? `Campagne en échec : ${campaign.lastError}`
        : campaign.lastResult || 'Campagne exécutée',
      detail: {
        examinees: summary.examined ?? 0,
        preparees: summary.prepared ?? 0,
        envoyees: summary.sent ?? 0,
        confirmees: summary.confirmed ?? 0,
        sousLeSeuil: summary.belowScore ?? 0,
        erreurs: summary.errors.slice(0, 5),
        essai: Boolean(dryRun),
      },
    });
  }

  return summary;
}
