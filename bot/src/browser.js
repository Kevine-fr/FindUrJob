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
const contexts = new Map(); // plateforme → BrowserContext persistant

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
 * Contexte persistant d'une plateforme. `headless: false` n'a de sens que si un
 * serveur X est branché — en conteneur, on reste en headless et l'utilisateur
 * reprend la main via les captures d'écran de `/login`.
 */
export async function getContext(platform, { headless = true } = {}) {
  const existing = contexts.get(platform);
  if (existing) return existing;

  const dir = path.join(PROFILE_ROOT, platform);
  await fs.mkdir(dir, { recursive: true });

  const context = await chromium.launchPersistentContext(dir, {
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    ...CONTEXT_OPTIONS,
  });

  // `navigator.webdriver` est le drapeau que tout le monde teste en premier.
  // On l'efface pour que la session se comporte comme le navigateur qu'elle est.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  context.setDefaultTimeout(30_000);
  context.on('close', () => contexts.delete(platform));
  contexts.set(platform, context);
  return context;
}

/** Ferme la session d'une plateforme sans effacer ses cookies. */
export async function closeContext(platform) {
  const context = contexts.get(platform);
  if (!context) return false;
  contexts.delete(platform);
  await context.close().catch(() => {});
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
