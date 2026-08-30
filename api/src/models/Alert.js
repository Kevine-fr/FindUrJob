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
     * Quota. Deux bornes distinctes, parce qu'elles répondent à deux gênes
     * différentes :
     *
     *   `maxPerRun`   — combien de candidatures un même message peut lister.
     *                   Au-delà d'une vingtaine, un courriel ne se lit plus.
     *   `maxPerWindow`— combien l'alerte a le droit d'en signaler sur une
     *                   période, elle-même libre. « 10 par heure » et « 50 par
     *                   semaine » sont deux besoins réels : figer la fenêtre à
     *                   la journée forçait à choisir entre les deux.
     */
    maxPerRun: { type: Number, min: 1, max: 100, default: 20 },
    maxPerWindow: { type: Number, min: 1, max: 1000, default: 60 },
    windowValue: { type: Number, min: 1, default: 1 },
    windowUnit: { type: String, enum: UNITES, default: 'jour' },

    /*
     * Échéance. Une alerte posée pour une recherche en cours n'a pas vocation à
     * survivre à cette recherche : passée cette date, elle ne se déclenche plus
     * et le dit dans son bilan, au lieu de disparaître sans explication.
     */
    expiresAt: { type: Date, default: null },

    /*
     * Fenêtre glissante en cours : quand elle a commencé, et ce qui a déjà été
     * signalé dedans. Une simple date de jour ne suffirait plus, la période
     * n'étant plus forcément la journée.
     */
    windowStartedAt: { type: Date, default: null },
    sentInWindow: { type: Number, default: 0 },

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

const UNITES_MS = {
  minute: 60_000,
  heure: 3_600_000,
  jour: 86_400_000,
  semaine: 604_800_000,
  mois: 2_592_000_000, // 30 jours — suffisant pour une fenêtre de quota
};

/**
 * Ce qu'il reste de quota dans la fenêtre en cours.
 *
 * La fenêtre est glissante et non calendaire : elle démarre au premier envoi et
 * court la durée choisie. Un quota calendaire se remettrait à zéro à minuit,
 * ce qui n'a aucun sens pour « au plus 10 par heure ».
 */
alertSchema.methods.quotaRestant = function quotaRestant() {
  const duree = (this.windowValue || 1) * (UNITES_MS[this.windowUnit] || UNITES_MS.jour);
  const debut = this.windowStartedAt?.getTime() || 0;
  const encoreOuverte = debut && Date.now() - debut < duree;

  const envoyees = encoreOuverte ? this.sentInWindow : 0;
  return {
    debut: encoreOuverte ? this.windowStartedAt : new Date(),
    envoyees,
    left: Math.max(0, this.maxPerWindow - envoyees),
  };
};

/** « 10 par heure », « 50 par semaine » — pour les bilans et l'interface. */
alertSchema.methods.libelleQuota = function libelleQuota() {
  const n = this.windowValue || 1;
  const unite = n > 1 ? `${n} ${this.windowUnit}s` : this.windowUnit;
  return `${this.maxPerWindow} par ${unite}`;
};

export default mongoose.model('Alert', alertSchema);
