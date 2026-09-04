import JobOffer from '../models/JobOffer.js';
import Application from '../models/Application.js';
import { APPLICATION_STATUSES } from './constants.js';

/**
 * Où en est une candidature, sur l'échelle des statuts.
 *
 * L'ordre de `APPLICATION_STATUSES` suit le déroulé réel — du brouillon au
 * refus — et sert donc à départager deux candidatures pour la même annonce :
 * « postulé » l'emporte sur « échec d'envoi », « entretien » sur « postulé ».
 */
const rang = (statut) => {
  const position = APPLICATION_STATUSES.indexOf(statut);
  return position === -1 ? 0 : position;
};

/**
 * Fusionne les offres qui désignent la même annonce.
 *
 * Welcome to the Jungle publie une même annonce sous **plusieurs
 * enregistrements** — un par bureau. Mesuré sur une collecte réelle : trois
 * identifiants consécutifs (4257961, 4257960, 4257959) pour le même poste chez
 * Galadrim, et dix-sept titres en double sur soixante ramenés.
 *
 * La collecte dédoublonnait sur `(source, externalId)`. Ces enregistrements
 * ayant chacun le leur, elle créait trois offres là où il n'y a qu'un poste —
 * donc trois candidatures, et trois « Postulé » dans la liste après
 * rapprochement. C'est ce que montrait la capture : Galadrim trois fois,
 * LegalPlace trois fois.
 *
 * L'adresse de l'annonce, elle, est identique : c'est la seule chose qui
 * identifie vraiment un poste. On regroupe donc là-dessus.
 *
 * Le nettoyage passe **avant** `dedupeApplications` : rapatrier les
 * candidatures sur l'offre survivante en crée mécaniquement plusieurs sur la
 * même offre, et c'est à lui de les fusionner ensuite.
 */
export async function dedupeOffers() {
  const groupes = await JobOffer.aggregate([
    // Une URL vide ne dit rien : deux offres saisies à la main sans adresse ne
    // sont pas la même annonce, et les regrouper détruirait des données.
    { $match: { sourceUrl: { $type: 'string', $ne: '' } } },
    {
      $group: {
        _id: { user: '$user', source: '$source', sourceUrl: '$sourceUrl' },
        ids: { $push: '$_id' },
        n: { $sum: 1 },
      },
    },
    { $match: { n: { $gt: 1 } } },
  ]);

  if (!groupes.length) return 0;

  let supprimees = 0;

  for (const groupe of groupes) {
    const doublons = await JobOffer.find({ _id: { $in: groupe.ids } }).sort({ createdAt: 1 });
    if (doublons.length < 2) continue;

    /*
     * On garde celle qui porte déjà une candidature, à défaut la plus ancienne.
     *
     * Supprimer l'offre suivie ferait disparaître son historique de la fiche,
     * alors même que c'est elle que le recruteur a reçue.
     */
    const avecCandidature = new Set(
      (await Application.find({ offer: { $in: groupe.ids } }).select('offer').lean()).map((a) =>
        String(a.offer)
      )
    );
    const garder =
      doublons.find((o) => avecCandidature.has(String(o._id))) || doublons[0];

    for (const autre of doublons) {
      if (autre._id.equals(garder._id)) continue;

      /*
       * Les candidatures suivent l'offre survivante — une par une.
       *
       * Un `updateMany` global violait l'index unique `(user, offer)` dès que
       * la survivante portait déjà une candidature : l'erreur remontait, le
       * `catch` de l'appelant l'écrivait dans les journaux, et plus rien n'était
       * nettoyé. Le nettoyage échouait donc précisément dans le cas qu'il
       * existe pour traiter.
       *
       * En cas de conflit on fusionne plutôt que d'écraser : le fil de la
       * candidature abandonnée rejoint celle qui reste, et le statut le plus
       * avancé l'emporte. Rien de ce qui s'est passé n'est perdu.
       */
      for (const candidature of await Application.find({ offer: autre._id })) {
        const existante = await Application.findOne({
          user: candidature.user,
          offer: garder._id,
        });

        if (!existante) {
          candidature.offer = garder._id;
          await candidature.save();
          continue;
        }

        for (const etape of candidature.timeline || []) existante.timeline.push(etape);
        if (rang(candidature.status) > rang(existante.status)) {
          existante.status = candidature.status;
          existante.appliedAt = existante.appliedAt || candidature.appliedAt;
        }
        existante.timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
        existante.notes = `${existante.notes || ''} — annonce publiée en double, candidatures fusionnées.`.trim();
        await existante.save();
        await Application.deleteOne({ _id: candidature._id });
      }

      await JobOffer.deleteOne({ _id: autre._id });
      supprimees += 1;
    }
  }

  console.log(`offres : ${supprimees} doublon(s) fusionné(s)`);
  return supprimees;
}
