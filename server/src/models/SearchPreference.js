import mongoose from 'mongoose';
import { SOURCES, CONTRACT_TYPES, REMOTE } from '../utils/constants.js';

// Ce que l'utilisateur cherche, une fois pour toutes : sert de filtre par défaut
// dans l'interface, et de cadrage pour les campagnes de candidature.
const searchPreferenceSchema = new mongoose.Schema(
  {
    // Propriétaire : toute donnée appartient à un compte. Indexé, car chaque
    // lecture filtre dessus.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    keywords: { type: [String], default: [] }, // métiers / technos visés
    excludedKeywords: { type: [String], default: [] }, // pour écarter des annonces
    locations: { type: [String], default: [] },

    contractTypes: { type: [{ type: String, enum: CONTRACT_TYPES }], default: [] },
    remotes: { type: [{ type: String, enum: REMOTE }], default: [] },
    sources: { type: [{ type: String, enum: SOURCES }], default: [] },

    // Ne candidater qu'au-dessus de ce score de matching.
    minScore: { type: Number, default: 0, min: 0, max: 100 },
    // Plafond de candidatures par jour : garde-fou volontaire.
    dailyQuota: { type: Number, default: 10, min: 1, max: 100 },
  },
  { timestamps: true }
);

searchPreferenceSchema.statics.forUser = async function (user) {
  return (await this.findOne({ user })) || this.create({ user });
};

export default mongoose.model('SearchPreference', searchPreferenceSchema);
