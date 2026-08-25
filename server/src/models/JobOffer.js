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

    /*
     * Position sur la carte, déduite de `location`.
     *
     * Aucune plateforme ne fournit de coordonnées : on les résout à partir du
     * texte de l’adresse, une fois, puis on les garde. `geoAt` distingue « pas
     * encore tenté » de « tenté sans succès » — sans lui, on relancerait
     * indéfiniment le géocodage des adresses introuvables, qui sont nombreuses
     * (« Télétravail », « France entière », « Île-de-France »).
     */
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    geoAt: { type: Date, default: null },
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
/*
 * Une offre appartient à un compte : l'unicité se compte **par compte**.
 *
 * L'index portait sur `{source, externalId}` seuls — hérité d'avant le
 * multi-comptes, quand la base n'avait qu'un propriétaire. Résultat : la
 * première personne à collecter une annonce LinkedIn la verrouillait pour
 * toutes les autres, dont la recherche échouait en « Doublon détecté ». Le
 * code applicatif filtrait pourtant déjà par `user` : seul l'index était resté
 * global.
 *
 * `sparse` reste nécessaire — beaucoup de sources ne fournissent pas
 * d'`externalId`, et ces offres sont alors dédoublonnées sur titre + société.
 */
jobOfferSchema.index({ user: 1, source: 1, externalId: 1 }, { unique: true, sparse: true });

export default mongoose.model('JobOffer', jobOfferSchema);
