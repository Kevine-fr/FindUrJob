import mongoose from 'mongoose';
import { CV_KINDS } from '../utils/constants.js';

// Une version de CV : soit le CV maître, soit une déclinaison ciblée
// produite par le moteur IA pour une offre précise.
const cvVersionSchema = new mongoose.Schema(
  {
    // Propriétaire : toute donnée appartient à un compte. Indexé, car chaque
    // lecture filtre dessus.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    label: { type: String, required: true, trim: true },
    kind: { type: String, enum: CV_KINDS, default: 'cible' },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOffer' }, // rempli si ciblé
    format: { type: String, enum: ['markdown', 'json'], default: 'markdown' },
    content: { type: String, default: '' }, // rendu produit par le moteur
    score: { type: Number, min: 0, max: 100 }, // score de matching si ciblé
    derivedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'CVVersion' }, // CV maître d'origine

    /*
     * Le PDF réellement joint à la candidature.
     *
     * On le garde tel quel plutôt que de le régénérer à la demande : le CV
     * envoyé il y a trois semaines doit rester consultable à l'identique, même
     * si le profil a changé depuis. C'est la pièce qu'un recruteur a sous les
     * yeux — la reconstruire serait afficher autre chose que ce qui est parti.
     *
     * `select: false` : quelques centaines de kilo-octets n'ont rien à faire
     * dans une liste de candidatures.
     */
    pdf: { type: Buffer, select: false },
    pdfBytes: { type: Number, default: 0 },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model('CVVersion', cvVersionSchema);
