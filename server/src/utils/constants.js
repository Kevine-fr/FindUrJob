// Valeurs de référence partagées par les modèles et la validation.

export const SOURCES = [
  'linkedin',
  'indeed',
  'hellowork',
  'francetravail',
  'apec',
  'welcometothejungle',
  'autre',
];

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
