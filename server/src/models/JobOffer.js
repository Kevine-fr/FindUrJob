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

    /*
     * Les deux signaux qui décident s'il vaut la peine de postuler.
     *
     * `publishedAt` est la date de la *plateforme*, distincte de `createdAt`
     * qui n'est que le moment où on l'a collectée : une annonce d'il y a trois
     * semaines découverte aujourd'hui n'est pas une annonce fraîche.
     *
     * `applicantCount` n'est pas toujours disponible — seules quelques
     * plateformes l'exposent. `null` veut dire « inconnu », surtout pas zéro :
     * filtrer sur « moins de 10 candidats » ne doit pas faire remonter tout ce
     * dont on ignore le chiffre.
     */
    publishedAt: { type: Date, index: true },
    applicantCount: { type: Number, min: 0, default: null },
  },
  { timestamps: true }
);

// Empêche les doublons quand un externalId est fourni pour une même source.
jobOfferSchema.index({ source: 1, externalId: 1 }, { unique: true, sparse: true });

export default mongoose.model('JobOffer', jobOfferSchema);
