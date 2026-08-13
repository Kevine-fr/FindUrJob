import mongoose from 'mongoose';
import { BOT_PLATFORMS, SOURCES } from '../utils/constants.js';

/**
 * Combien de candidatures viser par source, à chaque exécution.
 *
 * `limit: 0` (ou source absente) = source ignorée. Toutes les sources sont
 * réglables, mais seules celles pilotées au navigateur peuvent réellement
 * *envoyer* : les autres s'arrêtent au brouillon relu à la main, faute de
 * session sur laquelle candidater.
 */
const targetSchema = new mongoose.Schema(
  {
    source: { type: String, enum: SOURCES, required: true },
    limit: { type: Number, default: 0, min: 0, max: 50 },
  },
  { _id: false }
);

/**
 * La campagne automatique : ce que le robot fait, quand, et jusqu'où.
 *
 * Un seul document — comme les préférences et le profil, c'est un réglage
 * unique, pas une collection.
 */
const campaignSchema = new mongoose.Schema(
  {
    // Propriétaire : toute donnée appartient à un compte. Indexé, car chaque
    // lecture filtre dessus.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
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

    // Volume visé, source par source. Le total tenté à chaque exécution est la
    // somme de ces limites, plafonnée par `dailyLimit`.
    targets: {
      type: [targetSchema],
      default: () => BOT_PLATFORMS.map((source) => ({ source, limit: 3 })),
    },

    // Plafond global de la journée, toutes exécutions et sources confondues.
    dailyLimit: { type: Number, default: 10, min: 1, max: 100 },

    // En dessous de ce score de correspondance, l'offre est ignorée : mieux
    // vaut trois candidatures pertinentes que trente hors sujet.
    minScore: { type: Number, default: 60, min: 0, max: 100 },

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

campaignSchema.statics.forUser = async function (user) {
  return (await this.findOne({ user })) || this.create({ user });
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
