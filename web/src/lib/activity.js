/**
 * Vocabulaire de l'historique, côté interface.
 *
 * Miroir de `api/src/utils/activity.js`. Les deux listes doivent rester
 * alignées : le serveur filtre sur ces mêmes clés.
 */

/**
 * Familles d'évènements.
 *
 * `couleur` reprend les jetons du produit plutôt que des valeurs figées, pour
 * que le fil suive le thème clair comme le thème sombre.
 */
export const CATEGORIES = [
  {
    value: 'candidature',
    label: 'Candidatures',
    couleur: 'var(--accent)',
    aide: 'Chaque changement de statut, depuis la création du dossier.',
  },
  {
    value: 'cv',
    label: 'CV',
    couleur: '#7a5af8',
    aide: 'CV de référence, CV ciblés générés, et ceux réellement partis.',
  },
  {
    value: 'offre',
    label: 'Offres',
    couleur: '#1baf7a',
    aide: 'Volumes collectés, regroupés par jour et par plateforme.',
  },
  {
    value: 'campagne',
    label: 'Campagne',
    couleur: '#eb6834',
    aide: 'Chaque passe du robot : ce qu’elle a examiné, préparé, envoyé.',
  },
  {
    value: 'alerte',
    label: 'Alertes',
    couleur: '#eda100',
    aide: 'Chaque exécution, ce qu’elle a signalé et par quel canal.',
  },
  {
    value: 'compte',
    label: 'Plateformes',
    couleur: '#0aa06e',
    aide: 'Sessions ouvertes sur les plateformes de candidature.',
  },
  {
    value: 'session',
    label: 'Compte',
    couleur: '#62667a',
    aide: 'Connexions, inscription, vérification, appareils notifiés.',
  },
];

export const CATEGORIE_PAR_CLE = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

/**
 * D'où vient un évènement — et donc jusqu'où il remonte.
 *
 * La distinction est affichée parce qu'elle est visible : les familles
 * reconstituées depuis les collections métier ont un historique complet, celles
 * qui dépendent du journal démarrent à sa mise en service.
 */
export const ORIGINES = {
  reconstitue: {
    label: 'Reconstitué',
    aide: 'Déduit des données du compte : remonte aussi loin qu’elles existent.',
  },
  journalise: {
    label: 'Journalisé',
    aide: 'Écrit au moment du geste : ne remonte pas avant la mise en service du journal.',
  },
};

/** Périodes proposées. `jours: null` = depuis le début. */
export const PERIODES = [
  { value: '7', label: '7 jours', jours: 7 },
  { value: '30', label: '30 jours', jours: 30 },
  { value: '90', label: '90 jours', jours: 90 },
  { value: '365', label: '1 an', jours: 365 },
  { value: 'tout', label: 'Tout', jours: null },
];

/**
 * Traduit une période en bornes de requête.
 *
 * Les dates saisies à la main l'emportent sur le raccourci : c'est le geste le
 * plus précis des deux. La borne de fin est poussée à la fin de la journée,
 * sinon « au 12 mars » exclurait tout ce qui s'est passé le 12.
 */
export function bornesDe({ preset = '30', from = '', to = '' } = {}) {
  if (from || to) {
    const bornes = {};
    if (from) bornes.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) bornes.to = new Date(`${to}T23:59:59.999`).toISOString();
    return bornes;
  }
  const periode = PERIODES.find((p) => p.value === preset);
  if (!periode?.jours) return {};
  return { from: new Date(Date.now() - periode.jours * 86_400_000).toISOString() };
}
