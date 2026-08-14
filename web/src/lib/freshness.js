/**
 * Fraîcheur d'une offre et concurrence : les deux signaux qui décident s'il
 * vaut la peine de postuler.
 *
 * Une annonce de trois semaines avec 200 candidats et une annonce d'hier sans
 * candidat déclaré demandent des efforts très différents pour des chances très
 * différentes — encore faut-il que le chiffre soit affiché.
 */

export const UNITES = [
  { key: 'minute', label: 'minutes', ms: 60_000 },
  { key: 'heure', label: 'heures', ms: 3_600_000 },
  { key: 'jour', label: 'jours', ms: 86_400_000 },
  { key: 'semaine', label: 'semaines', ms: 604_800_000 },
  { key: 'mois', label: 'mois', ms: 2_592_000_000 },
];

/** Raccourcis courants, pour ne pas obliger à composer nombre + unité. */
export const PRESETS_FRAICHEUR = [
  { label: '24 h', value: 24, unit: 'heure' },
  { label: '3 jours', value: 3, unit: 'jour' },
  { label: '1 semaine', value: 1, unit: 'semaine' },
  { label: '1 mois', value: 1, unit: 'mois' },
];

/**
 * « il y a 3 jours ». Rend `null` quand la date est inconnue, pour que
 * l'appelant affiche « date inconnue » plutôt qu'un « il y a 56 ans » absurde.
 */
export function ilYA(date) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;

  const ecart = Date.now() - t;
  if (ecart < 0) return "à l'instant"; // horloges désynchronisées
  if (ecart < 60_000) return "à l'instant";

  // La plus grande unité qui donne au moins 1 : « 3 jours » plutôt que « 72 heures ».
  for (const unite of [...UNITES].reverse()) {
    const n = Math.floor(ecart / unite.ms);
    if (n >= 1) {
      if (unite.key === 'mois') return n === 1 ? 'il y a 1 mois' : `il y a ${n} mois`;
      const nom = n === 1 ? unite.label.replace(/s$/, '') : unite.label;
      return `il y a ${n} ${nom}`;
    }
  }
  return "à l'instant";
}

/**
 * Niveau de fraîcheur, pour teinter la mention.
 * Volontairement grossier : trois paliers se lisent d'un coup d'œil.
 */
export function fraicheur(date) {
  if (!date) return 'inconnue';
  const ecart = Date.now() - new Date(date).getTime();
  if (ecart < 2 * 86_400_000) return 'fraiche'; // moins de 2 jours
  if (ecart < 14 * 86_400_000) return 'recente';
  return 'ancienne';
}

/**
 * « 27 candidats ». `null` veut dire inconnu : on ne l'écrit pas « 0 candidat »,
 * ce qui laisserait croire à une offre déserte alors qu'on ne sait rien.
 */
export function candidats(nombre) {
  if (nombre === null || nombre === undefined) return null;
  const n = Number(nombre);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? `${n} candidat` : `${n} candidats`;
}

/** Peu de candidats = une vraie chance ; beaucoup = un signal à voir. */
export function concurrence(nombre) {
  if (nombre === null || nombre === undefined) return 'inconnue';
  if (nombre <= 10) return 'faible';
  if (nombre <= 50) return 'moyenne';
  return 'forte';
}
