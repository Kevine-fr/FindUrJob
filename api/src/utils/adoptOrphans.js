import mongoose from 'mongoose';
import User from '../models/User.js';

/**
 * Rattache les données d'avant le multi-utilisateur au premier compte créé.
 *
 * Avant l'authentification, tout vivait dans des collections sans propriétaire.
 * Ces documents deviendraient invisibles — et pire, `user` étant obligatoire,
 * toute écriture dessus échouerait. On les adopte donc une fois, au premier
 * démarrage suivant la création d'un compte administrateur.
 *
 * L'opération est idempotente : elle ne touche que les documents dépourvus de
 * propriétaire, et ne fait donc rien aux démarrages suivants.
 */

const COLLECTIONS = [
  'profiles',
  'searchpreferences',
  'campaigns',
  'platformaccounts',
  'joboffers',
  'applications',
  'cvversions',
];

export async function adoptOrphans() {
  // Le plus ancien administrateur : c'est le compte de l'installation.
  const proprietaire = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (!proprietaire) return null;

  const db = mongoose.connection.db;
  const bilan = {};
  let total = 0;

  for (const nom of COLLECTIONS) {
    const collection = db.collection(nom);
    const { modifiedCount } = await collection.updateMany(
      { user: { $exists: false } },
      { $set: { user: proprietaire._id } }
    );
    if (modifiedCount) {
      bilan[nom] = modifiedCount;
      total += modifiedCount;
    }
  }

  if (total) {
    console.log(
      `✓ ${total} document(s) rattaché(s) à ${proprietaire.email} :`,
      JSON.stringify(bilan)
    );
  }
  return { owner: proprietaire.email, total, bilan };
}
