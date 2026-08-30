import mongoose from 'mongoose';

/**
 * Un abonnement aux notifications push du navigateur.
 *
 * Un même compte en a autant que d'appareils et de navigateurs : téléphone,
 * portable, poste fixe. L'`endpoint` est l'identité de l'abonnement — c'est
 * l'URL que le service de messagerie du navigateur (Google, Mozilla, Apple)
 * nous donne pour joindre *cet* appareil, et c'est donc lui qui porte
 * l'unicité, pas l'utilisateur.
 *
 * Les clés `p256dh` et `auth` servent à chiffrer le message de bout en bout :
 * le service qui l'achemine ne peut pas le lire.
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    // Pour que l'utilisateur reconnaisse ses appareils dans la liste.
    label: { type: String, trim: true, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('PushSubscription', pushSubscriptionSchema);
