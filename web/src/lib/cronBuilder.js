/**
 * Traduction entre un rythme lisible et une expression cron.
 *
 * L'expression reste la source de vérité côté serveur — c'est elle que le
 * planificateur exécute. L'interface n'en est qu'une lecture : qui veut écrire
 * du cron le peut, les autres cochent des jours et des heures.
 *
 * `parse` ne reconnaît que les formes que `build` sait produire. Toute autre
 * expression bascule l'interface en mode expert, plutôt que d'afficher un
 * réglage approximatif qui trahirait ce qui tourne vraiment.
 */

export const JOURS = [
  { value: 1, court: 'L', long: 'lundi' },
  { value: 2, court: 'M', long: 'mardi' },
  { value: 3, court: 'M', long: 'mercredi' },
  { value: 4, court: 'J', long: 'jeudi' },
  { value: 5, court: 'V', long: 'vendredi' },
  { value: 6, court: 'S', long: 'samedi' },
  { value: 0, court: 'D', long: 'dimanche' },
];

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a - b);

/** { mode: 'heures', hours, days } | { mode: 'intervalle', every } → cron */
export function build(rythme) {
  if (rythme.mode === 'intervalle') {
    const every = Math.min(23, Math.max(1, Number(rythme.every) || 4));
    return `0 */${every} * * *`;
  }

  const hours = uniqueSorted((rythme.hours || []).map(Number).filter((h) => h >= 0 && h <= 23));
  const days = uniqueSorted((rythme.days || []).map(Number).filter((d) => d >= 0 && d <= 6));

  const h = hours.length ? hours.join(',') : '9';
  // Tous les jours cochés (ou aucun) revient à « tous les jours ».
  const d = days.length === 0 || days.length === 7 ? '*' : days.join(',');
  return `0 ${h} * * ${d}`;
}

/**
 * Développe une liste cron en valeurs : « 1-5 » → [1,2,3,4,5], « 9,17 » → [9,17].
 * Les plages sont indispensables : `0 9 * * 1-5` est la forme la plus courante
 * pour « du lundi au vendredi », et c'est le réglage par défaut.
 */
function expand(champ) {
  const valeurs = [];
  for (const bloc of champ.split(',')) {
    const plage = /^(\d{1,2})-(\d{1,2})$/.exec(bloc);
    if (plage) {
      const [debut, fin] = [Number(plage[1]), Number(plage[2])];
      if (debut > fin) return null;
      for (let i = debut; i <= fin; i++) valeurs.push(i);
      continue;
    }
    if (!/^\d{1,2}$/.test(bloc)) return null;
    valeurs.push(Number(bloc));
  }
  return uniqueSorted(valeurs);
}

/** cron → rythme lisible, ou `null` si l'expression sort du cadre simple. */
export function parse(expression) {
  const texte = String(expression || '').trim();

  const intervalle = /^0 \*\/(\d{1,2}) \* \* \*$/.exec(texte);
  if (intervalle) {
    const every = Number(intervalle[1]);
    if (every >= 1 && every <= 23) return { mode: 'intervalle', every, hours: [], days: [] };
  }

  const simple = /^0 ([\d,-]+) \* \* (\*|[\d,-]+)$/.exec(texte);
  if (simple) {
    const hours = expand(simple[1]);
    const days = simple[2] === '*' ? [] : expand(simple[2]);

    if (
      hours?.length &&
      days &&
      hours.every((h) => h >= 0 && h <= 23) &&
      days.every((d) => d >= 0 && d <= 6)
    ) {
      return { mode: 'heures', hours, days, every: 4 };
    }
  }

  return null;
}

/** Phrase française décrivant l'expression, pour confirmer ce qui va tourner. */
export function describe(expression) {
  const rythme = parse(expression);
  if (!rythme) return 'Rythme personnalisé';

  if (rythme.mode === 'intervalle') {
    return rythme.every === 1 ? 'Toutes les heures' : `Toutes les ${rythme.every} heures`;
  }

  const heures = rythme.hours.map((h) => `${h}h`).join(', ');

  if (!rythme.days.length) return `Chaque jour à ${heures}`;

  const ouvres = [1, 2, 3, 4, 5];
  const memeQue = (liste) =>
    liste.length === rythme.days.length && liste.every((d) => rythme.days.includes(d));

  if (memeQue(ouvres)) return `Du lundi au vendredi à ${heures}`;
  if (memeQue([0, 6])) return `Le week-end à ${heures}`;

  const noms = rythme.days
    .map((value) => JOURS.find((jour) => jour.value === value)?.long)
    .filter(Boolean);
  return `Le ${noms.join(', ')} à ${heures}`;
}
