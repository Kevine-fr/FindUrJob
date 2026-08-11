import mongoose from 'mongoose';
import { BOT_PLATFORMS } from '../utils/constants.js';

/**
 * Un compte de plateforme (LinkedIn, Indeed, HelloWork…).
 *
 * `password` ne contient jamais le mot de passe : il contient son chiffré
 * (voir `utils/vault.js`). Le champ est `select: false`, donc absent de toute
 * lecture qui ne le demande pas explicitement — une route ne peut pas le
 * divulguer par accident en renvoyant le document entier.
 */
const platformAccountSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: BOT_PLATFORMS,
      required: true,
      unique: true,
    },
    email: { type: String, default: '' },
    password: { type: String, default: '', select: false },
    // `password` étant `select: false`, il n'est pas chargé : ce drapeau permet
    // de dire « un mot de passe est enregistré » sans jamais lire le chiffré.
    hasPassword: { type: Boolean, default: false },

    // État de la session vue par le bot, rafraîchi à chaque vérification.
    sessionState: {
      type: String,
      enum: ['absente', 'connectee', 'expiree', 'verification', 'erreur'],
      default: 'absente',
    },
    lastCheckedAt: { type: Date },
    lastLoginAt: { type: Date },
    lastMessage: { type: String, default: '' },

    // Garde-fou de volume : un envoi de masse convertit moins bien qu'un
    // volume raisonnable, et attire l'attention des plateformes.
    dailyQuota: { type: Number, default: 10 },
    sentToday: { type: Number, default: 0 },
    quotaDate: { type: String, default: '' }, // AAAA-MM-JJ
  },
  { timestamps: true }
);

/** Vue sûre pour le front : jamais de chiffré, jamais de mot de passe. */
platformAccountSchema.methods.toPublic = function () {
  return {
    platform: this.platform,
    email: this.email,
    hasPassword: this.hasPassword,
    sessionState: this.sessionState,
    lastCheckedAt: this.lastCheckedAt,
    lastLoginAt: this.lastLoginAt,
    lastMessage: this.lastMessage,
    dailyQuota: this.dailyQuota,
    sentToday: this.remainingToday().used,
    remainingToday: this.remainingToday().left,
  };
};

/** Le compteur se remet à zéro au changement de jour, sans tâche planifiée. */
platformAccountSchema.methods.remainingToday = function () {
  const today = new Date().toISOString().slice(0, 10);
  const used = this.quotaDate === today ? this.sentToday : 0;
  return { used, left: Math.max(0, this.dailyQuota - used), today };
};

export default mongoose.model('PlatformAccount', platformAccountSchema);
