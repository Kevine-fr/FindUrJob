/**
 * Vocabulaire de l'historique, partagé par le journal, le service de
 * reconstitution et l'interface.
 *
 * L'historique a deux origines, et il faut les distinguer pour comprendre ce
 * qu'on peut promettre :
 *
 *   — **Reconstitué.** Déduit de ce que les collections gardent déjà
 *     (la timeline d'une candidature, la date d'un CV, celle d'une offre). Ces
 *     évènements existent rétroactivement : ils remontent aussi loin que les
 *     données du compte.
 *
 *   — **Journalisé.** Écrit au moment où le geste a lieu, dans `ActivityEvent`.
 *     C'est le seul moyen de garder ce qu'aucun document ne conserve : une
 *     campagne n'a qu'un `lastRunAt`, chaque passe écrase la précédente. Ces
 *     évènements ne remontent donc pas avant la mise en service du journal.
 */

/**
 * D'où vient un évènement. Affiché tel quel dans l'interface, parce que la
 * différence est visible pour qui remonte loin : les familles reconstituées
 * ont un historique complet, les familles journalisées démarrent à la mise en
 * service du journal.
 */
export const SOURCE_ORIGINE = {
  reconstitue: 'reconstitue',
  journalise: 'journalise',
};

/** Familles d'évènements. Sert de filtre dans l'interface. */
export const ACTIVITY_CATEGORIES = [
  'candidature',
  'cv',
  'offre',
  'campagne',
  'alerte',
  'compte',
  'session',
  'profil',
];

/**
 * Types d'évènements journalisés.
 *
 * Nommés « famille.geste » pour que le filtre par famille reste un simple
 * préfixe, et qu'ajouter un geste ne demande pas de toucher au filtre.
 */
export const ACTIVITY_KINDS = [
  'campagne.execution',
  'campagne.reglage',
  'alerte.execution',
  'alerte.notification',
  'alerte.reglage',
  'compte.session',
  'session.connexion',
  'session.inscription',
  'profil.modification',
  'offre.collecte',
];

/** Niveaux de gravité, pour teinter la ligne sans relire le texte. */
export const ACTIVITY_SEVERITIES = ['info', 'succes', 'avertissement', 'erreur'];

/** La famille d'un type : tout ce qui précède le premier point. */
export function categorieDe(kind) {
  return String(kind || '').split('.')[0];
}
