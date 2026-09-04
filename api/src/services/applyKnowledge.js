import mongoose from 'mongoose';
import PlatformQuestion from '../models/PlatformQuestion.js';
import User from '../models/User.js';
import { infoEchec } from '../utils/applyFailure.js';
import { journaliser } from './activityLog.js';
import { notifier } from './webPush.js';
import { appUrl, mailerConfigured, sendMail } from './mailer.js';

/**
 * La boucle d'apprentissage des candidatures.
 *
 * Trois gestes, et c'est tout :
 *
 *   1. `enregistrerQuestions` — retenir ce qu'un formulaire a réclamé et qu'on
 *      ne savait pas remplir.
 *   2. `reponsesPour` — restituer ce que la personne a déjà répondu, pour que
 *      le robot remplisse seul la fois suivante.
 *   3. `bilanEchecs` — compter, par plateforme et par cause, ce qui bloque.
 *
 * Ce n'est pas de l'apprentissage automatique : aucun modèle n'est entraîné.
 * C'est une boucle de rattrapage — chaque échec évitable produit une question,
 * chaque réponse retire cette cause d'échec pour toutes les candidatures
 * suivantes. Ce qui progresse, c'est la couverture des formulaires, pas un
 * modèle.
 */

/**
 * Verse dans la base de connaissances les questions restées sans réponse.
 *
 * Ne rejette jamais : une candidature réellement partie ne doit pas être
 * requalifiée en échec parce que la trace n'a pas pu s'écrire. La
 * qualification du résultat, elle, vit dans `applyOutcome.js` — elle est pure,
 * et n'a pas à attendre la base.
 *
 * @param champs   Ce que `appliquerResultat` a rendu comme `questions`.
 * @returns        Les questions nouvellement créées, pour la notification.
 */
export async function enregistrerQuestions(champs = [], { user, platform, offer } = {}) {
  if (!champs.length || !user || !platform) return [];

  /*
   * Ce qu'on sait déjà, quelle que soit la plateforme qui l'avait demandé.
   *
   * Une question créée pour une nouvelle plateforme ne doit pas rejoindre la
   * file d'attente si la réponse est connue : la personne l'a déjà donnée, et
   * la reposer sous prétexte que l'annonce vient d'ailleurs est du travail
   * qu'on lui inflige pour rien. La clé normalisée existe précisément pour
   * autoriser ce rapprochement.
   */
  const connues = new Map(
    (
      await PlatformQuestion.find({
        user,
        cle: { $in: champs.map((c) => c?.cle).filter(Boolean) },
        statut: 'repondue',
        reponse: { $ne: '' },
      })
        .select('cle reponse')
        .lean()
    ).map((q) => [q.cle, q.reponse])
  );

  const nouvelles = [];
  for (const champ of champs) {
    if (!champ?.cle) continue;
    try {
      /*
       * `upsert` plutôt que « lire puis écrire ».
       *
       * Deux passes de campagne peuvent rencontrer la même question en même
       * temps ; entre la lecture et l'écriture, le doublon passe. Ici la base
       * tranche, et l'index unique garantit le reste.
       *
       * `$setOnInsert` sur le libellé et la forme : une question déjà répondue
       * ne doit pas voir sa réponse invalidée parce que la plateforme a reformulé
       * son intitulé.
       */
      const avant = await PlatformQuestion.findOneAndUpdate(
        { user, platform, cle: champ.cle },
        {
          $inc: { rencontres: 1 },
          $set: { dernierVuLe: new Date() },
          $setOnInsert: {
            libelle: champ.libelle || champ.cle,
            forme: champ.forme || 'texte',
            options: champ.options || [],
            // Ce que la plateforme accepte : l'écran s'en sert pour proposer le
            // bon sélecteur, et pour refuser un fichier qui serait rejeté.
            accept: champ.accept || '',
            exempleOffre: offer || undefined,
            // Déjà répondue ailleurs : la ligne naît réglée, et la personne
            // n'en entend jamais parler.
            ...(connues.has(champ.cle)
              ? { reponse: connues.get(champ.cle), statut: 'repondue', repondueLe: new Date() }
              : { statut: 'en_attente' }),
          },
        },
        { upsert: true, new: false, setDefaultsOnInsert: true }
      );

      // `new: false` rend le document d'avant : `null` signifie « créé à
      // l'instant ». Seules celles qu'on ne sait pas remplir sont à signaler.
      if (!avant && !connues.has(champ.cle)) nouvelles.push(champ.libelle || champ.cle);
    } catch (erreur) {
      // Une collision sur l'index unique veut dire qu'une autre passe vient de
      // créer la même question : c'est le résultat voulu, pas une panne.
      if (erreur?.code !== 11000) {
        console.error('[candidature] question non enregistrée :', champ.cle, erreur?.message);
      }
    }
  }

  if (nouvelles.length) {
    await journaliser(user, 'campagne.reglage', {
      severity: 'avertissement',
      summary:
        `${nouvelles.length} information${nouvelles.length > 1 ? 's' : ''} à fournir pour ` +
        `candidater sur ${platform} : ${nouvelles.slice(0, 3).join(', ')}`,
      detail: { plateforme: platform, questions: nouvelles },
    });

    /*
     * Prévenir, et pas seulement journaliser.
     *
     * Une question qui attend est une candidature qui ne part pas. Tant que
     * l'information ne dort que dans la pastille du menu, elle n'est vue qu'à
     * la prochaine visite — et les campagnes de la nuit échouent toutes sur la
     * même cause, réparable en trente secondes.
     *
     * La notification ne bloque jamais l'enregistrement : la connaissance est
     * acquise même si le message ne part pas.
     */
    await prevenir(user, nouvelles, platform).catch((erreur) =>
      console.error('[candidature] notification des questions :', erreur?.message)
    );
  }

  return nouvelles;
}

/**
 * Signale à la personne qu'une information lui est demandée.
 *
 * Les deux canaux sont tentés indépendamment : le courriel porte le détail,
 * la notification poussée porte l'urgence. L'un peut être configuré sans
 * l'autre, et l'échec de l'un ne doit pas empêcher l'autre.
 */
async function prevenir(user, questions, platform) {
  const titre =
    questions.length > 1
      ? `${questions.length} informations à fournir`
      : 'Une information à fournir';
  const corps =
    `${questions.slice(0, 3).join(', ')}${questions.length > 3 ? '…' : ''} — ` +
    `réclamée${questions.length > 1 ? 's' : ''} par ${platform}. ` +
    'Une fois répondu, les candidatures suivantes partent seules.';

  const lien = `${appUrl()}/informations`;

  await Promise.allSettled([
    notifier(user, { title: titre, body: corps, url: lien, tag: 'questions' }),
    (async () => {
      if (!mailerConfigured()) return;
      const compte = await User.findById(user).select('email fullName').lean();
      if (!compte?.email) return;
      await sendMail({
        to: compte.email,
        subject: `FindUrJob — ${titre.toLowerCase()} pour continuer à candidater`,
        text: `${corps}\n\nRépondre ici : ${lien}\n`,
        html:
          `<p>${corps}</p>` +
          `<p><a href="${lien}">Répondre aux questions</a></p>` +
          `<p style="color:#666;font-size:13px">Chaque réponse élargit ce que le robot sait remplir : ` +
          `elle vaut pour toutes les plateformes qui posent la même question.</p>`,
      });
    })(),
  ]);
}

/**
 * Les réponses déjà données, prêtes à être envoyées au robot.
 *
 * Indexées par libellé normalisé — la même clé que celle sous laquelle le
 * robot reconnaîtra le champ.
 */
export async function reponsesPour(user, platform) {
  const questions = await PlatformQuestion.find({
    user,
    platform,
    statut: 'repondue',
    reponse: { $ne: '' },
  }).select('cle reponse forme fichierMime +fichier');

  /*
   * Une réponse peut être un fichier.
   *
   * Le robot ne peut pas « taper » dans un champ fichier — le navigateur
   * l'interdit — il lui faut les octets. On les lui passe encodés, sous une
   * forme qu'il distingue d'une valeur texte au premier coup d'œil : une
   * chaîne se saisit, un objet se dépose.
   */
  return Object.fromEntries(
    questions.map((q) => [
      q.cle,
      q.fichier?.length
        ? {
            nom: q.reponse,
            mime: q.fichierMime || 'application/octet-stream',
            contenu: q.fichier.toString('base64'),
          }
        : q.reponse,
    ])
  );
}

/**
 * Ce qui bloque, par plateforme et par cause.
 *
 * Sert la page de diagnostic : c'est le tableau qui dit où porter l'effort —
 * une cause réparable qui revient trente fois vaut qu'on s'y arrête, un
 * incident réseau isolé non.
 */
export async function bilanEchecs(Application, user, { depuis = null } = {}) {
  /*
   * L'identifiant arrive en chaîne depuis la requête HTTP.
   *
   * Une étape `$match` d'agrégation ne convertit pas, à la différence de
   * `find` : sans cette conversion explicite, le bilan serait toujours vide et
   * la page annoncerait « aucun blocage » sur un compte qui en accumule.
   */
  const proprietaire = mongoose.isValidObjectId(user)
    ? new mongoose.Types.ObjectId(String(user))
    : user;

  const lignes = await Application.aggregate([
    {
      $match: {
        user: proprietaire,
        'lastFailure.reason': { $nin: ['', null] },
        ...(depuis ? { 'lastFailure.at': { $gte: depuis } } : {}),
      },
    },
    {
      $group: {
        _id: { raison: '$lastFailure.reason', plateforme: '$lastFailure.platform' },
        n: { $sum: 1 },
        dernier: { $max: '$lastFailure.at' },
      },
    },
    { $sort: { n: -1 } },
  ]);

  return lignes.map((ligne) => ({
    raison: ligne._id.raison,
    plateforme: ligne._id.plateforme || 'inconnue',
    nombre: ligne.n,
    dernier: ligne.dernier,
    ...infoEchec(ligne._id.raison),
  }));
}
