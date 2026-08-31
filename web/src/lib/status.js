// Métadonnées d'affichage (miroir des enums côté serveur).

/**
 * Teinte d'un statut, et le filet assorti pour la bordure de sa pastille.
 *
 * La couleur passe par une variable CSS plutôt que par un hexadécimal : ces
 * teintes s'écrivent en **texte** sur une carte, et le thème sombre demande des
 * valeurs plus claires que le thème clair — un hexadécimal unique ne peut pas
 * tenir le contraste des deux côtés. Les deux jeux sont définis dans
 * `tokens.css`, et une valeur `var()` fonctionne telle quelle dans un `style`
 * en ligne.
 */
const teinte = (cle) => ({
  color: `var(--status-${cle})`,
  // Le filet est la même teinte très diluée. `color-mix` évite d'entretenir
  // dix variables de plus, là où l'ancien code concaténait un alpha au hexa —
  // ce qu'une `var()` ne permet plus.
  border: `color-mix(in srgb, var(--status-${cle}) 28%, transparent)`,
});

export const STATUS_META = {
  brouillon: { label: 'Brouillon', ...teinte('brouillon') },
  a_postuler: { label: 'À postuler', ...teinte('a_postuler') },
  // Distinct de « refusé » : là, c'est l'envoi qui a échoué, pas l'employeur
  // qui a dit non. Confondre les deux masque un problème réparable.
  echec_envoi: { label: 'Envoi échoué', ...teinte('echec_envoi') },
  // Ni parti ni échoué : on a appuyé, la plateforme n'a rien confirmé.
  a_verifier: { label: 'À vérifier', ...teinte('a_verifier') },
  postule: { label: 'Postulé', ...teinte('postule') },
  relance: { label: 'Relancé', ...teinte('relance') },
  entretien: { label: 'Entretien', ...teinte('entretien') },
  offre: { label: 'Offre', ...teinte('offre') },
  refuse: { label: 'Refusé', ...teinte('refuse') },
  abandonne: { label: 'Abandonné', ...teinte('abandonne') },
};

/** Repli pour un statut inconnu venu du serveur. */
export const STATUS_FALLBACK = teinte('brouillon');

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
