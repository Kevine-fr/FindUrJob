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
 * Une **échéance** facultative encadre l'envoi : au-delà, l'alerte s'éteint
 * d'elle-même plutôt que de continuer à parler d'une recherche terminée.
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
  },
  { timestamps: true }
);

/** L'alerte a-t-elle dépassé son échéance ? */
alertSchema.methods.expiree = function expiree() {
  return Boolean(this.expiresAt && this.expiresAt.getTime() < Date.now());
};

export default mongoose.model('Alert', alertSchema);
