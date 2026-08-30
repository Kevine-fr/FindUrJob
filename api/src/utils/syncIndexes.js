import JobOffer from '../models/JobOffer.js';
import Application from '../models/Application.js';
import PlatformAccount from '../models/PlatformAccount.js';
import PushSubscription from '../models/PushSubscription.js';

/**
 * Aligne les index de la base sur ceux déclarés dans les schémas.
 *
 * Mongoose crée les index manquants au démarrage, mais **ne supprime jamais**
 * ceux qui ont disparu du schéma : un index modifié laisse l'ancien en place,
 * et l'ancien continue de s'appliquer. C'est ce qui a fait échouer la recherche
 * d'offres des nouveaux comptes — `{source, externalId}` unique, hérité d'avant
 * le multi-comptes, rejetait toute annonce déjà collectée par quelqu'un d'autre
 * alors que le schéma déclarait bien `{user, source, externalId}`.
 *
 * `syncIndexes()` fait les deux : il crée ce qui manque et supprime ce qui ne
 * figure plus au schéma. On le limite aux collections dont l'unicité a changé —
 * un balayage général risquerait de faire tomber un index posé ailleurs à la
 * main, et la reconstruction coûte cher sur une grosse collection.
 */
export async function syncIndexes() {
  /*
   * Toutes les collections dont l'unicité a dû être cloisonnée par compte.
   *
   * `PlatformAccount` manquait à l'appel : son ancien index `{platform}` unique
   * survivait, si bien qu'une session HelloWork ouverte par un compte empêchait
   * tous les autres d'en créer une — même symptôme que pour les offres, même
   * cause. Chaque modèle passé au multi-comptes doit figurer ici.
   */
  for (const model of [JobOffer, Application, PlatformAccount, PushSubscription]) {
    try {
      const supprimes = await model.syncIndexes();
      if (supprimes?.length) {
        console.log(`index ${model.modelName} : ${supprimes.length} obsolète(s) supprimé(s)`);
      }
    } catch (error) {
      // Un index qui ne peut pas être reconstruit ne doit pas empêcher l'API de
      // démarrer : on le signale, l'ancien reste en place, l'application tourne.
      console.error(`index ${model.modelName} :`, error.message);
    }
  }
}
