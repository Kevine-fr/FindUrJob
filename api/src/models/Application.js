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
