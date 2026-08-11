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
