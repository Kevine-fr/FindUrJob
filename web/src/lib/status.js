// Métadonnées d'affichage (miroir des enums côté serveur).

export const STATUS_META = {
  brouillon: { label: 'Brouillon', color: '#62667a' },
  a_postuler: { label: 'À postuler', color: '#2d5bff' },
  // Distinct de « refusé » : là, c'est l'envoi qui a échoué, pas l'employeur
  // qui a dit non. Confondre les deux masque un problème réparable.
  echec_envoi: { label: 'Envoi échoué', color: '#eb6834' },
  // Ni parti ni échoué : on a appuyé, la plateforme n'a rien confirmé.
  a_verifier: { label: 'À vérifier', color: '#eda100' },
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
  'echec_envoi',
  'a_verifier',
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

/*
 * Couleur par plateforme, pour la carte.
 *
 * Sur une carte, l'étiquette ne tient pas dans un marqueur : la couleur est le
 * seul moyen de lire la provenance d'un coup d'œil. Elles sont choisies
 * distinctes deux à deux — deux bleus voisins rendraient la légende inutile.
 */
export const SOURCE_COLORS = {
  linkedin: '#0a66c2',
  indeed: '#5b3df5',
  hellowork: '#ff5f2e',
  francetravail: '#d0342c',
  apec: '#0aa06e',
  welcometothejungle: '#e0a800',
  adzuna: '#00a2b8',
  remotive: '#e0559d',
  autre: '#8a90a2',
};

/**
 * Plateformes sur lesquelles l'envoi automatique est possible — doit rester
 * aligné sur `BOT_PLATFORMS` côté serveur.
 *
 * Adzuna et Remotive en sont absents par nature : ce sont des agrégateurs,
 * sans compte candidat ni formulaire à eux.
 */
export const SENDABLE_SOURCES = [
  'linkedin',
  'indeed',
  'hellowork',
  'apec',
  'welcometothejungle',
  'francetravail',
];

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

/**
 * État d'une session de plateforme.
 *
 * Remonté ici depuis `AccountsPage` : la console d'administration affiche les
 * mêmes états sur la fiche d'un compte, et deux tables de libellés auraient
 * fini par diverger — l'une accentuée, l'autre pas.
 */
export const SESSION_STATE_LABELS = {
  connectee: 'Session ouverte',
  expiree: 'Session expirée',
  verification: 'Vérification requise',
  erreur: 'Erreur',
  absente: 'Pas de session',
};

/** Les deux modes d'une campagne, tels qu'on les nomme à l'écran. */
export const CAMPAIGN_MODE_LABELS = {
  preparer: 'préparer seulement',
  envoyer: 'préparer et envoyer',
};
