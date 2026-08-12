import mongoose from 'mongoose';
import { BOT_PLATFORMS } from '../utils/constants.js';

/**
 * La campagne automatique : ce que le robot fait, quand, et jusqu'où.
 *
 * Un seul document — comme les préférences et le profil, c'est un réglage
 * unique, pas une collection.
 */
const campaignSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },

    // Expression cron standard (minute heure jour mois jour-semaine).
    // L'interface propose des rythmes courants ; ce champ reste la source.
    cron: { type: String, default: '0 9 * * 1-5' },
    timezone: { type: String, default: 'Europe/Paris' },

    /*
     * Deux modes, et le prudent est celui par défaut.
     *
     * - « preparer » : cherche, score, rédige le CV ciblé et laisse la
     *   candidature en « à postuler ». Rien ne part sans relecture.
     * - « envoyer » : va jusqu'à l'envoi sur les plateformes où une session est
     *   ouverte. À n'activer qu'une fois les brouillons jugés bons.
     */
    mode: { type: String, enum: ['preparer', 'envoyer'], default: 'preparer' },

    // Garde-fous de volume : par exécution, et par jour toutes exécutions confondues.
    perRun: { type: Number, default: 5, min: 1, max: 50 },
    dailyLimit: { type: Number, default: 10, min: 1, max: 100 },

    // En dessous de ce score de correspondance, l'offre est ignorée : mieux
    // vaut trois candidatures pertinentes que trente hors sujet.
    minScore: { type: Number, default: 60, min: 0, max: 100 },

    // Plateformes sur lesquelles l'envoi est autorisé (mode « envoyer »).
    platforms: {
      type: [String],
      enum: BOT_PLATFORMS,
      default: () => [...BOT_PLATFORMS],
    },

    // Suivi de la dernière exécution, pour que la page dise ce qui s'est passé.
    lastRunAt: { type: Date },
    lastResult: { type: String, default: '' },
    lastError: { type: String, default: '' },
    running: { type: Boolean, default: false },

    // Compteur du jour, remis à zéro au changement de date sans tâche dédiée.
    sentToday: { type: Number, default: 0 },
    quotaDate: { type: String, default: '' },
  },
  { timestamps: true }
);

campaignSchema.statics.getSingleton = async function () {
  return (await this.findOne()) || this.create({});
};

/** Ce qu'il reste à faire aujourd'hui, compte tenu du plafond quotidien. */
campaignSchema.methods.remainingToday = function () {
  const today = new Date().toISOString().slice(0, 10);
  const used = this.quotaDate === today ? this.sentToday : 0;
  return { used, left: Math.max(0, this.dailyLimit - used), today };
};

/** Enregistre `count` candidatures traitées sur le quota du jour. */
campaignSchema.methods.consume = function (count) {
  const { used, today } = this.remainingToday();
  this.quotaDate = today;
  this.sentToday = used + count;
};

export default mongoose.model('Campaign', campaignSchema);
