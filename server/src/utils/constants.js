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

/**
 * Plateformes sur lesquelles on sait **candidater** depuis le compte de la
 * personne — donc celles qui méritent une session dans l'onglet Comptes.
 *
 * Adzuna et Remotive n'y sont pas, et ne peuvent pas y être : ce sont des
 * agrégateurs. Ils ne reçoivent aucune candidature et n'ont pas de compte
 * candidat ; leurs annonces renvoient toujours au site d'origine. Y ouvrir une
 * session n'aurait rien à quoi se connecter.
 */
export const BOT_PLATFORMS = [
  'linkedin',
  'indeed',
  'hellowork',
  'apec',
  'welcometothejungle',
  'francetravail',
];

/**
 * Sources dont les offres se **lisent** au navigateur piloté.
 *
 * France Travail n'y figure pas alors qu'on y candidate : ses offres se lisent
 * par l'API officielle, côté moteur Python. Lire et postuler ne demandent pas
 * les mêmes moyens — d'où deux listes plutôt qu'une.
 */
export const BOT_SEARCH_SOURCES = ['linkedin', 'indeed', 'hellowork', 'apec', 'welcometothejungle'];

export const CONTRACT_TYPES = ['cdi', 'cdd', 'stage', 'alternance', 'freelance', 'autre'];

export const REMOTE = ['sur_site', 'hybride', 'teletravail', 'non_precise'];

// Cycle de vie d'une candidature (le "fil" suivi dans l'interface).
export const APPLICATION_STATUSES = [
  'brouillon', // offre enregistrée, en préparation
  'a_postuler', // prête à envoyer
  'echec_envoi', // l'envoi automatique n'a pas abouti — à finir à la main
  'postule', // candidature envoyée
  'relance', // relance effectuée
  'entretien', // entretien décroché
  'offre', // proposition reçue
  'refuse', // refus
  'abandonne', // abandon / retrait
];

export const CV_KINDS = ['maitre', 'cible'];
