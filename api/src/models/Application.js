import mongoose from 'mongoose';
import { APPLICATION_STATUSES } from '../utils/constants.js';

// Un évènement de la timeline : chaque changement de statut en produit un.
const timelineEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: APPLICATION_STATUSES, required: true },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    // Propriétaire : toute donnée appartient à un compte. Indexé, car chaque
    // lecture filtre dessus.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer', required: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'brouillon', index: true },
    timeline: { type: [timelineEntrySchema], default: [] },
    cvVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'CVVersion' },
    coverLetter: { type: String },
    matchScore: { type: Number, min: 0, max: 100 }, // offre ↔ profil (IA)
    notes: { type: String },
    appliedAt: { type: Date },
    nextFollowUpAt: { type: Date },

    /*
     * La dernière tentative d'envoi, sous forme exploitable.
     *
     * La timeline garde déjà le récit — une phrase française par évènement.
     * Elle se lit, mais ne se compte pas : impossible d'en tirer « combien
     * d'échecs APEC pour cause de captcha », ni de décider ce qui mérite d'être
     * relancé. D'où ce bloc, écrasé à chaque tentative : c'est l'état courant
     * qui intéresse, l'historique restant dans la timeline.
     */
    lastFailure: {
      /** Code de `utils/applyFailure.js`. */
      reason: { type: String, default: '' },
      message: { type: String, default: '' },
      platform: { type: String, default: '' },
      at: { type: Date },
      /** Les questions restées sans réponse, quand c'est la cause. */
      fields: {
        type: [{ cle: String, libelle: String, forme: String, _id: false }],
        default: [],
      },
    },

    /*
     * Combien de fois l'envoi a été relancé. Borne les reprises automatiques :
     * une annonce qui échoue cinq fois de suite pour la même raison ne réussira
     * pas à la sixième, et réessayer sans fin ressemble beaucoup à un
     * acharnement du point de vue de la plateforme.
     */
    retryCount: { type: Number, default: 0 },
    lastRetryAt: { type: Date },

    /*
     * L'écran au moment où ça a bloqué.
     *
     * Le robot photographiait déjà la page sur presque tous ses chemins
     * d'échec — vingt et un endroits — et le serveur jetait l'image sans la
     * regarder. Elle vaut pourtant mieux qu'un code et une phrase : « Ce champ
     * est obligatoire » en rouge sous un champ précis se comprend d'un coup
     * d'œil, là où « champs_manquants » demande d'aller vérifier.
     *
     * `select: false` : ces octets ne doivent jamais partir avec une liste de
     * candidatures. Ils se demandent explicitement, une image à la fois.
     */
    failureShot: { type: Buffer, select: false },
    failureShotAt: { type: Date },
  },
  { timestamps: true }
);

// À la création, on ouvre la timeline avec le statut initial.
applicationSchema.pre('save', function (next) {
  if (this.isNew && this.timeline.length === 0) {
    this.timeline.push({ status: this.status, note: 'Candidature créée' });
  }
  next();
});

/*
 * Une seule candidature par offre et par compte — garanti par la base.
 *
 * Le contrôle en amont peut toujours être contourné par une course entre deux
 * exécutions, ou par un chemin qu'on aura oublié de protéger. Postuler deux
 * fois à la même annonce se voit du côté du recruteur : la garantie doit donc
 * tenir à l'endroit où rien ne peut passer outre, pas seulement dans le code
 * qui y mène.
 */
applicationSchema.index({ user: 1, offer: 1 }, { unique: true });

export default mongoose.model('Application', applicationSchema);
