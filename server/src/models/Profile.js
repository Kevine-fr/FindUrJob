import mongoose from 'mongoose';

// Un poste : dans un CV, ce qui compte n'est pas le paragraphe mais la liste
// de faits. `bullets` est la forme de référence ; `description` reste accepté
// (CV importés, anciens profils) et se découpe en puces à la lecture.
const experienceSchema = new mongoose.Schema(
  {
    role: String,
    company: String,
    location: String,
    period: String,
    current: { type: Boolean, default: false },
    bullets: { type: [String], default: [] },
    description: String,
  },
  { _id: false }
);

const educationSchema = new mongoose.Schema(
  { degree: String, school: String, location: String, period: String, detail: String },
  { _id: false }
);

// Même forme qu'une expérience : dans le rendu, un projet est une expérience
// rangée dans une autre rubrique.
const projectSchema = new mongoose.Schema(
  {
    name: String,
    role: String,
    company: String,
    location: String,
    period: String,
    url: String,
    bullets: { type: [String], default: [] },
    description: String,
  },
  { _id: false }
);

const certificationSchema = new mongoose.Schema(
  { name: String, issuer: String, date: String, url: String },
  { _id: false }
);

const languageSchema = new mongoose.Schema({ name: String, level: String }, { _id: false });

const linkSchema = new mongoose.Schema(
  {
    // linkedin | github | portfolio | autre — pilote l'icône au rendu
    type: { type: String, default: 'autre' },
    url: String,
    label: String,
  },
  { _id: false }
);

// Les compétences groupées par famille (« Langages », « Cloud & DevOps »…) :
// c'est ce qui rend la colonne de gauche lisible plutôt qu'un pavé de mots.
const skillGroupSchema = new mongoose.Schema(
  { label: String, items: { type: [String], default: [] } },
  { _id: false }
);

// Réglages de rendu du CV. Ils vivent avec le profil pour qu'un export refait
// six mois plus tard sorte exactement le même document.
const cvOptionsSchema = new mongoose.Schema(
  {
    template: { type: String, default: 'sidebar' }, // sidebar | classique
    accent: { type: String, default: '#2d5bff' },
    showPhoto: { type: Boolean, default: true },
    // Densité de base ; l'ajustement automatique à une page part de là.
    density: { type: Number, default: 1 },
    // Rubriques masquées à l'export, sans les effacer du profil.
    hidden: { type: [String], default: [] },
  },
  { _id: false }
);

// Profil unique de l'utilisateur : la matière première que le moteur IA
// reciblera pour chaque offre, et la source du CV exporté en PDF.
const profileSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: '' },
    headline: { type: String, default: '' }, // ex : "Développeur Full Stack / DevOps"
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    summary: { type: String, default: '' },
    // Photo en data URI : le CV doit rester exportable sans dépendre d'un fichier.
    photo: { type: String, default: '' },

    skills: { type: [String], default: [] }, // liste à plat, historique
    skillGroups: { type: [skillGroupSchema], default: [] },
    experiences: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    languages: { type: [languageSchema], default: [] },
    links: { type: [linkSchema], default: [] },

    cvOptions: { type: cvOptionsSchema, default: () => ({}) },

    masterCv: { type: String, default: '' }, // CV maître : texte réécrit par offre

    // Métadonnées du CV déposé (le fichier n'est pas conservé, seul son texte l'est)
    cvFileName: { type: String, default: '' },
    cvUploadedAt: { type: Date },
    cvChars: { type: Number, default: 0 },
    cvPages: { type: Number, default: 0 },
    cvWarnings: { type: [String], default: [] },
  },
  { timestamps: true }
);

/**
 * `links` était une Map { github: "url" } ; c'est désormais une liste typée.
 * Un document enregistré avant ce changement ne peut pas être casté par
 * Mongoose (objet → tableau = CastError), et ferait échouer *toute* lecture du
 * profil. La conversion passe donc par le driver brut, avant que le modèle ne
 * touche au document.
 */
async function migrateLegacyLinks(model) {
  const raw = await model.collection.findOne({});
  if (!raw || Array.isArray(raw.links)) return;

  const links = Object.entries(raw.links || {})
    .filter(([, url]) => typeof url === 'string' && url.trim())
    .map(([type, url]) => ({ type, url: url.trim(), label: '' }));

  await model.collection.updateOne({ _id: raw._id }, { $set: { links } });
}

// Récupère l'unique profil (le crée vide si absent).
profileSchema.statics.getSingleton = async function () {
  await migrateLegacyLinks(this);
  let profile = await this.findOne();
  if (!profile) profile = await this.create({});
  return profile;
};

export default mongoose.model('Profile', profileSchema);
