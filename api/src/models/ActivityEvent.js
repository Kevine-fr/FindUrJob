import mongoose from 'mongoose';
import { ACTIVITY_KINDS, ACTIVITY_SEVERITIES } from '../utils/activity.js';

/**
 * Journal d'activité : ce qu'aucun autre document ne conserve.
 *
 * Une campagne porte `lastRunAt`, `lastResult`, `lastError` — trois champs
 * écrasés à chaque passe. Savoir que la dernière exécution a échoué ne dit rien
 * de la précédente, ni de la fréquence des échecs. Idem pour les alertes, et
 * pour les connexions dont `User` ne garde qu'un compteur et une date.
 *
 * D'où cette collection : une ligne par geste, jamais réécrite. Elle ne
 * remplace pas les données existantes — la timeline d'une candidature reste la
 * source de vérité de son statut — elle comble ce qui, sinon, disparaît.
 *
 * Volumétrie : une campagne quotidienne et deux alertes produisent de l'ordre
 * du millier de lignes par an et par compte. Aucune purge n'est posée pour
 * l'instant ; c'est un historique, et le tronquer lui retirerait sa raison
 * d'être. L'index `{ user, at }` garde la lecture rapide quoi qu'il arrive.
 */
const activityEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ACTIVITY_KINDS, required: true },
    at: { type: Date, default: Date.now },

    /** Une phrase lisible telle quelle : c'est ce que l'interface affiche. */
    summary: { type: String, default: '', trim: true },

    /** Gravité, pour teinter la ligne sans avoir à relire le texte. */
    severity: { type: String, enum: ACTIVITY_SEVERITIES, default: 'info' },

    /*
     * Charge structurée, libre de forme.
     *
     * Les gestes journalisés n'ont pas les mêmes dimensions — une passe de
     * campagne compte des candidatures, une connexion note une adresse IP. Un
     * schéma figé obligerait à le migrer à chaque nouveau type ; ici le résumé
     * porte le sens, et ce champ le détail pour qui veut creuser.
     */
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Rattachements facultatifs, pour rebondir depuis la ligne.
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer' },
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    alert: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
  },
  { timestamps: true }
);

/*
 * L'historique se lit toujours « ce compte, du plus récent au plus ancien »,
 * souvent borné à une période. Cet index sert le tri et la borne d'un coup ;
 * sans lui, chaque ouverture de la page trierait la collection entière.
 */
activityEventSchema.index({ user: 1, at: -1 });

export default mongoose.model('ActivityEvent', activityEventSchema);
