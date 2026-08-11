import * as linkedin from './linkedin.js';
import * as indeed from './indeed.js';
import * as hellowork from './hellowork.js';

/**
 * Registre des plateformes pilotées au navigateur.
 *
 * Y figure ce qui n'a pas d'API exploitable. France Travail, Adzuna et Remotive
 * n'y sont pas : elles ont une API officielle, et le moteur Python s'en charge.
 */
export const PLATFORMS = { linkedin, indeed, hellowork };

export const PLATFORM_NAMES = Object.keys(PLATFORMS);

export function getPlatform(name) {
  const platform = PLATFORMS[name];
  if (!platform) {
    const err = new Error(
      `Plateforme inconnue : « ${name} ». Attendu : ${PLATFORM_NAMES.join(', ')}.`
    );
    err.status = 400;
    throw err;
  }
  return platform;
}
