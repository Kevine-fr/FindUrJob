import * as linkedin from './linkedin.js';
import * as indeed from './indeed.js';
import * as hellowork from './hellowork.js';
import * as apec from './apec.js';
import * as wttj from './wttj.js';
import * as francetravail from './francetravail.js';

/**
 * Registre des plateformes pilotées au navigateur.
 *
 * Deux besoins distincts amènent une plateforme ici : **lire** les offres quand
 * elle n'a pas d'API publique, et **candidater**, ce qui réclame toujours une
 * session — aucune API ne postule à votre place.
 *
 * France Travail illustre le second cas seul : ses offres se lisent par l'API
 * officielle (côté moteur Python), mais postuler passe par l'espace candidat,
 * donc par le navigateur. Adzuna et Remotive restent absentes : ce sont des
 * agrégateurs, leurs annonces renvoient toujours ailleurs.
 */
export const PLATFORMS = {
  linkedin,
  indeed,
  hellowork,
  apec,
  welcometothejungle: wttj,
  francetravail,
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
