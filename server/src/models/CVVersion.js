import mongoose from 'mongoose';
import { CV_KINDS } from '../utils/constants.js';

// Une version de CV : soit le CV maître, soit une déclinaison ciblée
// produite par le moteur IA pour une offre précise.
const cvVersionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    kind: { type: String, enum: CV_KINDS, default: 'cible' },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer' }, // rempli si ciblé
    format: { type: String, enum: ['markdown', 'json'], default: 'markdown' },
    content: { type: String, default: '' }, // rendu produit par le moteur
    score: { type: Number, min: 0, max: 100 }, // score de matching si ciblé
    derivedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'CVVersion' }, // CV maître d'origine
  },
  { timestamps: true }
);

export default mongoose.model('CVVersion', cvVersionSchema);
