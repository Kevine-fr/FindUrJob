import mongoose from 'mongoose';

const experienceSchema = new mongoose.Schema(
  { role: String, company: String, period: String, description: String },
  { _id: false }
);

const educationSchema = new mongoose.Schema(
  { degree: String, school: String, period: String },
  { _id: false }
);

// Profil unique de l'utilisateur : la matière première que le moteur IA
// reciblera pour chaque offre.
const profileSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: '' },
    headline: { type: String, default: '' }, // ex : "Développeur Full Stack / DevOps"
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    summary: { type: String, default: '' },
    skills: { type: [String], default: [] },
    experiences: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    links: { type: Map, of: String, default: {} }, // github, linkedin, portfolio…
    masterCv: { type: String, default: '' }, // CV maître (base du reciblage)
  },
  { timestamps: true }
);

// Récupère l'unique profil (le crée vide si absent).
profileSchema.statics.getSingleton = async function () {
  let profile = await this.findOne();
  if (!profile) profile = await this.create({});
  return profile;
};

export default mongoose.model('Profile', profileSchema);
