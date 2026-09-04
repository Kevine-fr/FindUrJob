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

    /*
     * Ce qu'on a appris en essayant de postuler.
     *
     * Mesuré sur des annonces réelles : sur Welcome to the Jungle, quatorze
     * annonces sur dix-huit ne sont qu'une vitrine renvoyant vers l'ATS de
     * l'employeur (Workday, SmartRecruiters…) ; sur France Travail, deux sur
     * six. Ce ne sont pas des candidatures ratées — il n'y a simplement rien à
     * envoyer ici. Les compter comme des échecs faussait les statistiques, et
     * surtout les laissait consommer le quota de la campagne à chaque passage.
     *
     *   direct  — le formulaire est sur la plateforme, on sait le remplir
     *   externe — la candidature se fait sur le site de l'employeur
     *   bloque  — la plateforme refuse le navigateur piloté (anti-bot)
     *
     * `applyUrl` garde l'adresse réelle du recruteur : c'est ce qui permet de
     * finir la candidature en un clic plutôt que de la chercher.
     */
    applyMode: {
      type: String,
      enum: ['inconnu', 'direct', 'externe', 'bloque'],
      default: 'inconnu',
      index: true,
    },
    applyUrl: { type: String, trim: true },
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
 * L'index a longtemps été `sparse`, ce qui ne veut pas dire ce qu'on croit sur
 * un index composé : Mongo n'écarte un document que si TOUS les champs sont
 * absents. `user` et `source` étant toujours là, les offres sans `externalId`
 * étaient bel et bien indexées, avec `externalId: null` — et la deuxième offre
 * sans identifiant d'une même plateforme entrait en collision avec la première.
 * D'où les « Doublon détecté » sur des offres pourtant distinctes.
 *
 * `partialFilterExpression` dit ce que `sparse` laissait croire : n'indexer que
 * les offres qui portent réellement un `externalId`. Les autres — saisies à la
 * main, ou venues d'une source qui n'en fournit pas — sont dédoublonnées sur
 * titre + société par le code de collecte.
 */
jobOfferSchema.index(
  { user: 1, source: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } }
);

/*
 * Une annonce, une offre — garanti par la base, pas seulement par le code.
 *
 * Welcome to the Jungle publie une même annonce sous plusieurs enregistrements,
 * un par bureau, chacun avec son propre `externalId` : la déduplication par
 * identifiant en créait donc trois pour un seul poste, et trois candidatures
 * s'ensuivaient. Leur adresse, elle, est rigoureusement la même.
 *
 * Le contrôle côté collecte ne suffit pas : deux passes simultanées peuvent
 * lire « rien en base » avant que l'une n'écrive. C'est l'index qui tranche.
 *
 * Une adresse vide n'identifie rien, et deux offres saisies à la main sans URL
 * ne sont pas la même annonce : il faut donc les exclure de l'index.
 *
 * `$gt: ''` et non `$ne: ''` — MongoDB n'accepte qu'un jeu restreint
 * d'opérateurs dans un `partialFilterExpression`, et `$ne` n'en fait pas
 * partie. Il refusait la spécification entière, sans que rien n'échoue par
 * ailleurs : l'index n'existait pas, et la garantie non plus. Toute chaîne non
 * vide est strictement supérieure à la chaîne vide, la condition est la même.
 */
jobOfferSchema.index(
  { user: 1, source: 1, sourceUrl: 1 },
  { unique: true, partialFilterExpression: { sourceUrl: { $type: 'string', $gt: '' } } }
);

export default mongoose.model('JobOffer', jobOfferSchema);
