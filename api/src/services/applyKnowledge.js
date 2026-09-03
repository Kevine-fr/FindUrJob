import mongoose from 'mongoose';
import PlatformQuestion from '../models/PlatformQuestion.js';
import { infoEchec } from '../utils/applyFailure.js';
import { journaliser } from './activityLog.js';

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
            statut: 'en_attente',
            exempleOffre: offer || undefined,
          },
        },
        { upsert: true, new: false, setDefaultsOnInsert: true }
      );

      // `new: false` rend le document d'avant : `null` signifie « créé à
      // l'instant », donc une question que la personne n'a jamais vue.
      if (!avant) nouvelles.push(champ.libelle || champ.cle);
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
  }

  return nouvelles;
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
  })
    .select('cle reponse')
    .lean();

  return Object.fromEntries(questions.map((q) => [q.cle, q.reponse]));
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
