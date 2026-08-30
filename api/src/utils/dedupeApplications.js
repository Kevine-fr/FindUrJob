import Application from '../models/Application.js';

/**
 * Fusionne les candidatures en double sur une même offre.
 *
 * Une version antérieure repêchait les envois marqués en échec pour retenter sa
 * chance. C'était bâti sur une erreur d'interprétation : « échec » ne voulait
 * pas dire « rien n'est parti », mais « aucune confirmation vue ». Des offres
 * ont donc pu recevoir deux candidatures, et deux entrées existent en base.
 *
 * L'index unique `(user, offer)` interdit désormais ce cas — mais Mongo refuse
 * de construire un index unique sur des données qui le violent déjà, et échoue
 * en silence côté application : sans ce nettoyage, la garantie n'existerait pas
 * là où elle est justement nécessaire.
 *
 * On garde la candidature la plus avancée (celle qui porte le plus d'histoire),
 * en lui rapatriant le fil des autres : rien de ce qui s'est passé n'est perdu.
 */
export async function dedupeApplications() {
  const groupes = await Application.aggregate([
    { $group: { _id: { user: '$user', offer: '$offer' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);

  if (!groupes.length) return 0;

  let supprimees = 0;

  for (const groupe of groupes) {
    const doublons = await Application.find({ _id: { $in: groupe.ids } }).sort({ createdAt: 1 });

    // La plus « avancée » : celle qui a le plus d'étapes, puis la plus ancienne
    // — c'est elle que le recruteur a vue en premier.
    const garder = doublons.reduce((meilleure, courante) =>
      (courante.timeline?.length || 0) > (meilleure.timeline?.length || 0) ? courante : meilleure
    );

    for (const autre of doublons) {
      if (autre._id.equals(garder._id)) continue;
      for (const entree of autre.timeline || []) garder.timeline.push(entree);
      await Application.deleteOne({ _id: autre._id });
      supprimees += 1;
    }

    garder.timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
    garder.notes = `${garder.notes || ''} — doublon(s) fusionné(s) automatiquement.`.trim();
    await garder.save();
  }

  console.log(`candidatures : ${supprimees} doublon(s) fusionné(s)`);
  return supprimees;
}
