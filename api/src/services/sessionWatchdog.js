import PlatformAccount from '../models/PlatformAccount.js';
import { botSessions, botConfigured } from './botService.js';
import { tryRevive } from './sessionRevival.js';

/**
 * Veille sur les sessions des plateformes.
 *
 * Jusqu'ici la reconnexion était **réactive** : on découvrait qu'une session
 * était morte au moment de candidater, la campagne perdait ce tour, et il
 * fallait attendre la suivante. France Travail expire le plus vite, si bien que
 * la moitié des passes s'y cassaient les dents.
 *
 * La veille inverse la logique : on regarde régulièrement, et on rouvre avant
 * que la campagne n'en ait besoin. Deux garde-fous, parce qu'il ne s'agit pas
 * de marteler les plateformes :
 *
 *   — on ne tente une reconnexion **que** pour les comptes dont le mot de passe
 *     est enregistré ; les autres relèvent de la reprise en main ;
 *   — une seule tentative par passe et par plateforme. S'acharner sur une
 *     plateforme qui réclame un code ne la ferait pas céder, et déclencherait
 *     surtout une alerte de sécurité sur le compte de la personne.
 */

/** Une passe de veille pour un compte. */
export async function veillerUtilisateur(user) {
  if (!botConfigured()) return { skipped: 'navigateur piloté non configuré' };

  // Seuls les comptes réparables nous intéressent : sans mot de passe
  // enregistré, constater l'expiration n'avancerait à rien.
  const reparables = await PlatformAccount.find({ user, hasPassword: true }).select('platform');
  if (!reparables.length) return { skipped: 'aucun identifiant enregistré' };

  const { sessions } = await botSessions(user);
  const bilan = { verifiees: sessions.length, rouvertes: [], echouees: [] };

  for (const session of sessions) {
    if (session.state === 'connectee') continue;
    if (!reparables.some((compte) => compte.platform === session.platform)) continue;

    const rouverte = await tryRevive(session.platform, user);
    (rouverte ? bilan.rouvertes : bilan.echouees).push(session.platform);
  }

  return bilan;
}

/**
 * Une passe pour tout le monde.
 *
 * Séquentielle et non parallèle : chaque vérification ouvre un Chromium complet,
 * et les lancer tous d'un coup ferait un pic mémoire de plusieurs centaines de
 * mégaoctets sur un serveur qui fait déjà tourner le reste.
 */
export async function veillerSessions() {
  const comptes = await PlatformAccount.find({ hasPassword: true }).distinct('user');
  const resultats = [];

  for (const user of comptes) {
    try {
      const bilan = await veillerUtilisateur(user.toString());
      if (bilan.rouvertes?.length || bilan.echouees?.length) {
        resultats.push({ user: user.toString(), ...bilan });
      }
    } catch (error) {
      console.error(`veille ${user} :`, error.message);
    }
  }

  return resultats;
}
