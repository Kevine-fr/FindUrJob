import mongoose from 'mongoose';
import { SOURCES } from '../utils/constants.js';

/**
 * Une question qu'une plateforme a posée, et la réponse de la personne.
 *
 * C'est la pièce qui fait progresser le taux de réussite. Jusqu'ici, un
 * formulaire réclamant « Années d'expérience » faisait échouer la candidature,
 * et la suivante, et toutes les autres : rien ne retenait la question, donc
 * rien ne pouvait y répondre. Ici, la première rencontre l'enregistre, la
 * personne répond une fois, et le robot remplit seul ensuite.
 *
 * La clé est le libellé normalisé (`cle`) : « Années d'expérience »,
 * « Annees d'experience » et « ANNÉES D'EXPÉRIENCE » désignent la même
 * question, et poser trois fois la même chose serait le meilleur moyen de
 * faire abandonner.
 *
 * Portée : par compte **et** par plateforme. La même intitulé peut appeler des
 * réponses différentes selon le site — et surtout, la réponse d'une personne
 * n'a pas à servir à une autre.
 */
const platformQuestionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, enum: SOURCES, required: true },

    /** Libellé normalisé : l'identité de la question. */
    cle: { type: String, required: true },
    /** Libellé tel que la plateforme l'affiche, pour le montrer à la personne. */
    libelle: { type: String, default: '', trim: true },

    /*
     * Forme attendue, relevée sur le champ : texte, nombre, téléphone, date,
     * paragraphe, case, ou choix dans une liste. Sert à poser la bonne
     * question — demander « Niveau d'études » en texte libre quand la
     * plateforme n'accepte que quatre valeurs ne mène nulle part.
     */
    forme: {
      type: String,
      enum: ['texte', 'paragraphe', 'nombre', 'telephone', 'date', 'case', 'choix'],
      default: 'texte',
    },
    /** Réponses possibles, quand le champ est une liste. */
    options: { type: [String], default: [] },

    reponse: { type: String, default: '' },

    /*
     * `en_attente` tant que rien n'a été répondu, `repondue` ensuite.
     * `ignoree` est un choix explicite : certaines questions ne concernent pas
     * la personne, et les lui remontrer à chaque échec serait du harcèlement.
     */
    statut: {
      type: String,
      enum: ['en_attente', 'repondue', 'ignoree'],
      default: 'en_attente',
      index: true,
    },

    /*
     * Combien de candidatures cette question a bloquées. C'est l'ordre de
     * priorité de la page : répondre à celle qui a coûté douze candidatures
     * vaut mieux que de commencer par celle vue une fois.
     */
    rencontres: { type: Number, default: 1 },
    dernierVuLe: { type: Date, default: Date.now },

    /** Une annonce où la question s'est posée, pour donner le contexte. */
    exempleOffre: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer' },
  },
  { timestamps: true }
);

/*
 * Une question par compte, par plateforme et par clé. L'index unique porte la
 * règle plutôt qu'un test avant écriture : deux passes de campagne peuvent
 * rencontrer la même question en même temps, et le contrôle applicatif
 * laisserait passer le doublon entre la lecture et l'écriture.
 */
platformQuestionSchema.index({ user: 1, platform: 1, cle: 1 }, { unique: true });

export default mongoose.model('PlatformQuestion', platformQuestionSchema);
