// Valeurs de référence partagées par les modèles et la validation.

export const SOURCES = [
  'linkedin',
  'indeed',
  'hellowork',
  'francetravail',
  'apec',
  'welcometothejungle',
  'adzuna',
  'remotive',
  'autre',
];

// Les plateformes pilotées au navigateur : celles qui n'ont pas d'API ouverte,
// et sur lesquelles on peut donc aussi candidater depuis le compte de la
// personne. Les autres sources (France Travail, Adzuna, Remotive) passent par
// le moteur Python et leurs API officielles.
export const BOT_PLATFORMS = ['linkedin', 'indeed', 'hellowork'];

/**
 * Sources dont les offres se **lisent** au navigateur piloté.
 *
 * Sur-ensemble de `BOT_PLATFORMS` : APEC et Welcome to the Jungle n'ont pas
 * d'API publique et passent donc par le bot, mais on n'y candidate pas — leurs
 * annonces renvoient au formulaire de l'employeur. D'où deux listes : ce qu'on
 * sait lire, et ce sur quoi on sait postuler.
 */
export const BOT_SEARCH_SOURCES = [...BOT_PLATFORMS, 'apec', 'welcometothejungle'];

export const CONTRACT_TYPES = ['cdi', 'cdd', 'stage', 'alternance', 'freelance', 'autre'];

export const REMOTE = ['sur_site', 'hybride', 'teletravail', 'non_precise'];

// Cycle de vie d'une candidature (le "fil" suivi dans l'interface).
export const APPLICATION_STATUSES = [
  'brouillon', // offre enregistrée, en préparation
  'a_postuler', // prête à envoyer
  'postule', // candidature envoyée
  'relance', // relance effectuée
  'entretien', // entretien décroché
  'offre', // proposition reçue
  'refuse', // refus
  'abandonne', // abandon / retrait
];

export const CV_KINDS = ['maitre', 'cible'];
