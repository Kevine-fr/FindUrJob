import mongoose from 'mongoose';
import { SOURCES, APPLICATION_STATUSES } from '../utils/constants.js';

/**
 * Une alerte : « préviens-moi quand des candidatures correspondent à ceci ».
 *
 * Les critères sont le décalque exact des filtres de l'onglet Candidatures —
 * recherche libre, statuts, plateformes, fraîcheur de l'annonce, concurrence.
 * C'est délibéré : on règle une alerte comme on filtre une liste, sans avoir à
 * réapprendre un second vocabulaire.
 *
 * Deux garde-fous encadrent l'envoi, parce qu'une alerte trop bavarde finit en
 * courriels non lus : un **quota** (par envoi et par jour) et une **échéance**
 * au-delà de laquelle elle s'éteint d'elle-même.
 */

const UNITES = ['minute', 'heure', 'jour', 'semaine', 'mois'];

const alertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, trim: true, default: 'Nouvelle alerte' },
    enabled: { type: Boolean, default: true },

    // --- Critères, miroir des filtres de l'onglet Candidatures ---
    q: { type: String, trim: true, default: '' },
    statuses: { type: [{ type: String, enum: APPLICATION_STATUSES }], default: [] },
    sources: { type: [{ type: String, enum: SOURCES }], default: [] },
    maxAgeValue: { type: Number, min: 0, default: 0 }, // 0 = peu importe
    maxAgeUnit: { type: String, enum: UNITES, default: 'jour' },
    maxApplicants: { type: Number, min: 0, default: null },

    // --- Canaux ---
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: false },

    // --- Rythme ---
    cron: { type: String, default: '0 8 * * *' },
    timezone: { type: String, default: 'Europe/Paris' },

    /*
     * Quotas. `maxPerRun` borne la taille d'un message, `maxPerDay` le nombre
     * de candidatures signalées dans la journée — au-delà, l'alerte se tait
     * jusqu'au lendemain plutôt que de noyer la boîte de réception.
     */
    maxPerRun: { type: Number, min: 1, max: 100, default: 20 },
    maxPerDay: { type: Number, min: 1, max: 500, default: 60 },

    /*
     * Échéance. Une alerte posée pour une recherche en cours n'a pas vocation à
     * survivre à cette recherche : passée cette date, elle ne se déclenche plus
     * et le dit dans son bilan, au lieu de disparaître sans explication.
     */
    expiresAt: { type: Date, default: null },

    /*
     * `lastCheckAt` est la frontière du « nouveau ».
     *
     * On ne signale que les candidatures modifiées depuis la dernière passe :
     * c'est ce qui évite de reprendre la même liste à chaque exécution. Une
     * alerte qui vient d'être créée part de sa date de création — sans quoi sa
     * première exécution annoncerait l'historique entier.
     */
    lastCheckAt: { type: Date, default: Date.now },
    lastRunAt: { type: Date, default: null },
    lastResult: { type: String, default: '' },
    lastError: { type: String, default: '' },

    // Compteur du jour, remis à zéro au changement de date.
    sentDay: { type: String, default: '' }, // AAAA-MM-JJ
    sentToday: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** Ce qu'il reste de quota aujourd'hui. */
alertSchema.methods.remainingToday = function remainingToday() {
  const jour = new Date().toISOString().slice(0, 10);
  const envoyees = this.sentDay === jour ? this.sentToday : 0;
  return { jour, envoyees, left: Math.max(0, this.maxPerDay - envoyees) };
};

/** L'alerte a-t-elle dépassé son échéance ? */
alertSchema.methods.expiree = function expiree() {
  return Boolean(this.expiresAt && this.expiresAt.getTime() < Date.now());
};

export default mongoose.model('Alert', alertSchema);
