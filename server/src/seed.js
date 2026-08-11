import 'dotenv/config';
import mongoose from 'mongoose';
import JobOffer from './models/JobOffer.js';
import Application from './models/Application.js';
import Profile from './models/Profile.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/filo';

const sampleOffers = [
  {
    title: 'Développeur Full Stack Node / Nest / React / Next',
    company: 'Studio Numérique',
    location: 'Paris (75)',
    source: 'indeed',
    sourceUrl: 'https://example.com/offre/full-stack-paris',
    contractType: 'cdi',
    remote: 'hybride',
    salary: '45–55 k€',
    description:
      'Développeur full stack maîtrisant Node.js, NestJS, React et Next.js pour renforcer ' +
      "l'équipe produit. Bonus : Docker, CI/CD, PostgreSQL.",
  },
  {
    title: 'Ingénieur DevOps (Docker / CI-CD / Observabilité)',
    company: 'Cloud Atelier',
    location: 'Remote (France)',
    source: 'hellowork',
    sourceUrl: 'https://example.com/offre/devops',
    contractType: 'cdi',
    remote: 'teletravail',
    salary: '50–60 k€',
    description:
      'Pipelines CI/CD, infrastructure Docker, monitoring Prometheus / Grafana.',
  },
  {
    title: 'Développeur Backend Laravel / PostgreSQL',
    company: 'Éditeur SaaS',
    location: 'Lyon (69)',
    source: 'linkedin',
    sourceUrl: 'https://example.com/offre/laravel',
    contractType: 'cdd',
    remote: 'sur_site',
    description: "Développement d'API Laravel, base PostgreSQL, tests et déploiement.",
  },
];

async function run() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('Connecté. Réinitialisation des collections…');
  await Promise.all([JobOffer.deleteMany({}), Application.deleteMany({})]);

  const offers = await JobOffer.insertMany(sampleOffers);
  console.log(`✓ ${offers.length} offres insérées`);

  await Application.create({
    offer: offers[0]._id,
    status: 'postule',
    appliedAt: new Date(),
    notes: 'Cible prioritaire — stack alignée avec mon profil.',
  });
  await Application.create({ offer: offers[1]._id, status: 'brouillon' });
  console.log('✓ 2 candidatures de démo créées');

  const profile = await Profile.getSingleton();
  profile.headline = 'Développeur Full Stack / DevOps';
  profile.skills = [
    'React', 'Next.js', 'Node.js', 'NestJS', 'Laravel',
    'Docker', 'CI/CD', 'PostgreSQL',
  ];
  profile.masterCv = '> Colle ici ton CV maître : il servira de base au reciblage par offre.';
  await profile.save();
  console.log('✓ Profil initialisé');

  await mongoose.disconnect();
  console.log('Terminé.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
