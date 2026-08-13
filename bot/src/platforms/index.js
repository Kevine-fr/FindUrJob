import * as linkedin from './linkedin.js';
import * as indeed from './indeed.js';
import * as hellowork from './hellowork.js';
import * as apec from './apec.js';
import * as wttj from './wttj.js';

/**
 * Registre des plateformes pilotées au navigateur.
 *
 * Y figure ce qui n'a pas d'API publique. France Travail, Adzuna et Remotive
 * n'y sont pas : elles ont une API officielle, et le moteur Python s'en charge.
 *
 * Toutes ne se valent pas : LinkedIn, Indeed et HelloWork acceptent une session
 * et une candidature ; APEC et Welcome to the Jungle ne servent qu'à *lire* les
 * offres — leurs annonces renvoient au formulaire de l'employeur.
 */
export const PLATFORMS = {
  linkedin,
  indeed,
  hellowork,
  apec,
  welcometothejungle: wttj,
};

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
