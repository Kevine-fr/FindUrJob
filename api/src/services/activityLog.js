import ActivityEvent from '../models/ActivityEvent.js';

/**
 * Écrit une ligne dans le journal d'activité.
 *
 * **Ne rejette jamais.** Un journal est un témoin, pas un maillon : si l'écriture
 * échoue, la campagne doit continuer à envoyer ses candidatures et la connexion
 * à aboutir. Une exception remontée d'ici transformerait une panne d'écriture
 * secondaire en panne du geste principal — exactement ce qu'un historique ne
 * doit pas pouvoir provoquer.
 *
 * L'appel n'est volontairement pas attendu par la plupart des appelants : le
 * geste métier n'a pas à attendre son propre compte rendu.
 */
export async function journaliser(user, kind, { summary = '', severity = 'info', detail = {}, at, ...liens } = {}) {
  if (!user || !kind) return null;
  try {
    return await ActivityEvent.create({
      user,
      kind,
      at: at || new Date(),
      summary,
      severity,
      detail,
      ...liens,
    });
  } catch (erreur) {
    // Visible dans les journaux du conteneur, sans conséquence pour l'appelant.
    console.error('[activite] écriture impossible :', kind, erreur?.message);
    return null;
  }
}
