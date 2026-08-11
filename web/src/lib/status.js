// Métadonnées d'affichage (miroir des enums côté serveur).

export const STATUS_META = {
  brouillon: { label: 'Brouillon', color: '#62667a' },
  a_postuler: { label: 'À postuler', color: '#2d5bff' },
  postule: { label: 'Postulé', color: '#7a5af8' },
  relance: { label: 'Relancé', color: '#d99400' },
  entretien: { label: 'Entretien', color: '#1f9d57' },
  offre: { label: 'Offre', color: '#0aa06e' },
  refuse: { label: 'Refusé', color: '#e5484d' },
  abandonne: { label: 'Abandonné', color: '#9aa0ae' },
};

export const STATUS_ORDER = [
  'brouillon',
  'a_postuler',
  'postule',
  'relance',
  'entretien',
  'offre',
  'refuse',
  'abandonne',
];

export const SOURCE_LABELS = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  hellowork: 'HelloWork',
  francetravail: 'France Travail',
  apec: 'APEC',
  welcometothejungle: 'WTTJ',
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  autre: 'Autre',
};

export const CONTRACT_LABELS = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  alternance: 'Alternance',
  freelance: 'Freelance',
  autre: 'Autre',
};

export const REMOTE_LABELS = {
  sur_site: 'Sur site',
  hybride: 'Hybride',
  teletravail: 'Télétravail',
  non_precise: 'Non précisé',
};
