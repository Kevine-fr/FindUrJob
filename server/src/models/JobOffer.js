import mongoose from 'mongoose';
import { SOURCES, CONTRACT_TYPES, REMOTE } from '../utils/constants.js';

// Une offre = les données brutes d'une annonce. Le fait de la poursuivre
// est modélisé séparément par Application.
const jobOfferSchema = new mongoose.Schema(
  {
    // Propriétaire : toute donnée appartient à un compte. Indexé, car chaque
    // lecture filtre dessus.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    location: { type: String, trim: true },
    source: { type: String, enum: SOURCES, default: 'autre' },
    sourceUrl: { type: String, trim: true },
    externalId: { type: String, trim: true }, // id sur la plateforme d'origine (dédup)
    description: { type: String },
    contractType: { type: String, enum: CONTRACT_TYPES, default: 'autre' },
    remote: { type: String, enum: REMOTE, default: 'non_precise' },
    salary: { type: String, trim: true },
    keywords: { type: [String], default: [] }, // extraits par le moteur IA (à venir)
  },
  { timestamps: true }
);

// Empêche les doublons quand un externalId est fourni pour une même source.
jobOfferSchema.index({ source: 1, externalId: 1 }, { unique: true, sparse: true });

export default mongoose.model('JobOffer', jobOfferSchema);
