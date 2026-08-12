import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Deux usages du navigateur, deux régimes.
 *
 * - Le rendu PDF part d'un navigateur jetable, sans état ni réseau : il doit
 *   produire deux fois le même fichier pour la même entrée.
 * - Les plateformes, elles, ont besoin de *durer* : un contexte persistant par
 *   plateforme garde les cookies sur disque, donc la session ouverte. C'est ce
 *   qui évite de se reconnecter (et de refaire la 2FA) à chaque candidature.
 */

const PROFILE_ROOT = process.env.BOT_PROFILE_DIR || '/data/profiles';

// Un vrai en-tête de navigateur récent : sans lui, plusieurs sites servent une
// page dégradée où plus aucun sélecteur ne correspond.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CONTEXT_OPTIONS = {
  userAgent: USER_AGENT,
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  viewport: { width: 1440, height: 900 },
};

let renderBrowser = null;
// plateforme → Promise<BrowserContext>. La promesse, et non le contexte résolu :
// voir `getContext` — c'est ce qui empêche deux lancements concurrents sur le
// même profil.
const contexts = new Map();

/** Navigateur partagé pour le rendu (pas de cookies, pas d'état). */
export async function getRenderBrowser() {
  if (!renderBrowser || !renderBrowser.isConnected()) {
    renderBrowser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  }
  return renderBrowser;
}

/**
 * Contexte persistant d'une plateforme.
 *
 * Volontairement *visible* (`headless: false`) : il tourne sur l'écran virtuel
 * du conteneur, que l'utilisateur peut reprendre à la souris via noVNC quand
 * une connexion bute sur une 2FA ou un captcha. La session qu'il obtient est
 * alors dans le même profil que celui réutilisé ensuite par le robot.
 *
 * Effet de bord bienvenu : un Chrome complet passe des contrôles anti-robot
 * qu'un navigateur sans interface échoue systématiquement.
 */
/**
 * Retire le verrou laissé par une exécution précédente.
 *
 * Chromium marque un profil comme « ouvert » par un lien `SingletonLock` qui
 * pointe vers `<nom-machine>-<pid>`. Le volume des profils survivant au
 * conteneur, ce verrou désigne après un redémarrage un processus et une machine
 * qui n'existent plus — et Chromium refuse alors d'ouvrir le profil.
 *
 * On ne les supprime qu'au moment où aucun contexte n'est ouvert de notre côté
 * (garanti par le cache ci-dessous) : le verrou ne peut donc être que périmé.
 */
async function clearStaleLocks(dir) {
  await Promise.all(
    ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].map((name) =>
      fs.rm(path.join(dir, name), { force: true, recursive: true }).catch(() => {})
    )
  );
}

export function getContext(platform, { headless = !process.env.DISPLAY } = {}) {
  const existing = contexts.get(platform);
  if (existing) return existing;

  const launching = (async () => {
    const dir = path.join(PROFILE_ROOT, platform);
    await fs.mkdir(dir, { recursive: true });
    await clearStaleLocks(dir);

    const context = await chromium.launchPersistentContext(dir, {
      headless,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        // Une seule fenêtre à l'écran : sans ça les profils s'empilent en cascade
        // et l'utilisateur ne sait plus laquelle il pilote.
        '--start-maximized',
      ],
      ...CONTEXT_OPTIONS,
    });

    // `navigator.webdriver` est le drapeau que tout le monde teste en premier.
    // On l'efface pour que la session se comporte comme le navigateur qu'elle est.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    context.setDefaultTimeout(30_000);
    context.on('close', () => contexts.delete(platform));
    return context;
  })();

  /*
   * On met en cache la *promesse*, pas le contexte résolu.
   *
   * La page Comptes interroge les trois plateformes en parallèle : avec un
   * cache renseigné seulement après le lancement, deux appels simultanés sur
   * la même plateforme lançaient deux Chromium sur le même dossier de profil,
   * et le second échouait sur le verrou.
   */
  contexts.set(platform, launching);

  // Un lancement raté ne doit pas rester en cache, sinon la plateforme est
  // définitivement cassée jusqu'au redémarrage du service.
  launching.catch(() => contexts.delete(platform));

  return launching;
}

/** Ferme la session d'une plateforme sans effacer ses cookies. */
export async function closeContext(platform) {
  const pending = contexts.get(platform);
  if (!pending) return false;
  contexts.delete(platform);

  // `pending` est une promesse : un lancement en cours doit aboutir avant
  // d'être fermé, sinon le navigateur survit au retrait du cache.
  const context = await pending.catch(() => null);
  if (context) await context.close().catch(() => {});
  return true;
}

/** Déconnexion réelle : le profil sur disque est supprimé. */
export async function forgetContext(platform) {
  await closeContext(platform);
  await fs.rm(path.join(PROFILE_ROOT, platform), { recursive: true, force: true });
}

/** Plateformes ayant déjà un profil sur disque. */
export async function knownProfiles() {
  try {
    const entries = await fs.readdir(PROFILE_ROOT, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function shutdown() {
  await Promise.all([...contexts.keys()].map(closeContext));
  if (renderBrowser?.isConnected()) await renderBrowser.close().catch(() => {});
  renderBrowser = null;
}
