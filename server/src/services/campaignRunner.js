import Campaign from '../models/Campaign.js';
import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import CVVersion from '../models/CVVersion.js';
import SearchPreference from '../models/SearchPreference.js';
import { tailorCv, scoreOffer } from './tailoringService.js';
import { botApply, botConfigured, renderCvPdf } from './botService.js';
import { buildTailoredCvHtml } from './cvDocument.js';
import { BOT_PLATFORMS } from '../utils/constants.js';

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
    const [profile, prefs] = await Promise.all([
      Profile.forUser(user).then((p) =>
        Profile.findById(p._id).select("+masterCvHtml +cvFile")
      ),
      SearchPreference.forUser(user),
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
    const known = await Application.find({ user }).distinct('offer');

    const baseFilter = { _id: { $nin: known }, user };
    if (prefs.contractTypes?.length) baseFilter.contractType = { $in: prefs.contractTypes };
    if (prefs.remotes?.length) baseFilter.remote = { $in: prefs.remotes };

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

    for (const target of wanted) {
      if (budget <= 0) break;
      const take = Math.min(target.limit, budget);
      // On en tire plus que le quota : beaucoup seront écartées au score.
      const pool = await JobOffer.find({ ...baseFilter, source: target.source })
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
              if (profile.cvFile?.length) {
                // Le fichier d'origine : aucune réimpression, rien à dégrader.
                buffer = profile.cvFile;
              } else if (profile.masterCvHtml) {
                ({ buffer } = await renderCvPdf(profile.masterCvHtml));
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
            // Le PDF voyage avec la demande : le bot n'a aucun fichier à aller
            // chercher, et les deux services n'ont pas de disque en commun.
            const outcome = await botApply(source, offer, {
              filename: `CV-${(profile.fullName || 'candidat').replace(/\s+/g, '-')}.pdf`,
              content: cvPdf.toString('base64'),
            }, user, {
              // Le formulaire HelloWork exige nom, prénom, e-mail et la lettre :
              // le CV seul ne suffit pas à le faire partir.
              applicant: {
                firstName: (profile.fullName || "").split(" ")[0] || "",
                lastName: (profile.fullName || "").split(" ").slice(1).join(" ") || "",
                email: profile.email || "",
              },
              coverLetter: result.coverLetter || "",
              dryRun,
            });

            if (outcome.status === 'sent') {
              application.status = 'postule';
              application.appliedAt = new Date();
              application.timeline.push({
                status: 'postule',
                note: 'Envoyée par la campagne, CV reciblé joint.',
              });
              cv.sentAt = new Date();
              await cv.save();
              summary.sent += 1;
              summary.perSource[source].sent += 1;
            } else if (outcome.status === 'dry-run') {
              // Essai : le formulaire était prêt à partir, on n'a pas appuyé.
              // La candidature reste « à postuler », rien n'est daté.
              application.timeline.push({
                status: 'a_postuler',
                note: `Essai concluant : ${outcome.message || 'formulaire prêt.'}`,
              });
              summary.ready += 1;
            } else if (outcome.status === 'uncertain') {
              /*
               * Le bouton a été actionné, la plateforme n'a rien confirmé.
               *
               * Ni « postulé » — ce serait affirmer sans preuve — ni « échec » :
               * la candidature est peut-être arrivée, et c'est précisément le
               * cas qui a produit un double envoi. On le nomme pour ce qu'il
               * est, et personne n'y retouche automatiquement.
               */
              application.status = 'a_verifier';
              application.notes += ` — à vérifier : ${outcome.message || ''}`;
              application.timeline.push({
                status: 'a_verifier',
                note: outcome.message || 'Issue inconnue.',
              });
              summary.manual += 1;
              summary.perSource[source].manual += 1;
            } else {
              // « manual » : l'envoi a bien été tenté, et il n'a pas abouti —
              // formulaire absent, CV refusé, question de l'employeur. Le noter
              // « à postuler » le rendait indiscernable d'une préparation
              // réussie : c'est précisément ce qu'on veut voir.
              application.status = 'echec_envoi';
              application.notes += ` — à finir à la main : ${outcome.message || ''}`;
              application.timeline.push({
                status: 'echec_envoi',
                note: outcome.message || 'À finir à la main.',
              });
              summary.manual += 1;
              summary.perSource[source].manual += 1;
            }
          } catch (sendError) {
            application.status = 'echec_envoi';
            application.notes += ` — envoi impossible : ${sendError.message}`;
            application.timeline.push({ status: 'echec_envoi', note: sendError.message });
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

    campaign.lastResult =
      `${summary.examined} offre(s) examinée(s)` +
      (detail.length ? ` — ${detail.join(' · ')}` : ' — aucune retenue') +
      (summary.belowScore ? ` · ${summary.belowScore} sous le seuil` : '');
    campaign.lastError = summary.errors.slice(0, 3).join(' | ');
  } catch (error) {
    campaign.lastError = error.message;
    summary.errors.push(error.message);
  } finally {
    campaign.running = false;
    await campaign.save();
  }

  return summary;
}
