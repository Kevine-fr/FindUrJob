/**
 * Causes d'échec d'une candidature, sous forme de codes stables.
 *
 * Jusqu'ici, un envoi raté ne laissait qu'une phrase française dans la note de
 * la candidature. Lisible par une personne, inexploitable par la machine : on
 * ne pouvait ni compter « combien d'échecs APEC pour cause de captcha », ni
 * décider quoi retenter, ni savoir quelle information demander à l'utilisateur.
 *
 * Ces codes sont ce que le robot rend en plus du message. Ils sont **stables** :
 * les renommer casserait l'historique déjà enregistré. La table des libellés,
 * de ce qui est réparable et de ce qui vaut la peine d'être retenté vit côté
 * API (`api/src/utils/applyFailure.js`) — le robot n'a besoin que d'émettre le
 * bon code, pas de savoir ce qu'on en fera.
 */

import { stripAccents } from './common.js';

export const RAISONS = {
  /** Un contrôle anti-robot barre la route. Aucune automatisation ne passe. */
  CAPTCHA: 'captcha',
  /** Des champs obligatoires qu'on ne sait pas remplir : demandables à la personne. */
  CHAMPS_MANQUANTS: 'champs_manquants',
  /** Le fichier a été déposé, la plateforme ne l'a pas pris. */
  CV_REFUSE: 'cv_refuse',
  /** Aucun champ pour joindre le CV : la candidature partirait nue. */
  CV_SANS_CHAMP: 'cv_sans_champ',
  /** Aucun formulaire de candidature sur la page. */
  FORMULAIRE_ABSENT: 'formulaire_absent',
  /** Formulaire trouvé, mais aucun bouton pour l'envoyer. */
  BOUTON_ABSENT: 'bouton_absent',
  /** L'annonce renvoie vers l'ATS de l'employeur : hors de notre portée. */
  REDIRECTION_EXTERNE: 'redirection_externe',
  /** La plateforme refuse le navigateur piloté. */
  PLATEFORME_BLOQUEE: 'plateforme_bloquee',
  /** Plus de session ouverte sur la plateforme. */
  SESSION_EXPIREE: 'session_expiree',
  /** L'annonce a disparu entre la collecte et l'envoi. */
  OFFRE_DISPARUE: 'offre_disparue',
  /** Délai dépassé, coupure : rien ne dit que la plateforme soit en cause. */
  RESEAU: 'reseau',
  /** Rien de reconnu — à documenter quand le cas se présente. */
  INCONNU: 'inconnu',

  /*
   * Les deux issues incertaines. Ce ne sont pas des échecs : le bouton a été
   * actionné, la candidature est peut-être partie. Les nommer séparément
   * importe — c'est la confusion entre « échoué » et « peut-être parti » qui
   * produit les doubles envois.
   */
  POST_ENVOI_INCOMPLET: 'post_envoi_incomplet',
  SANS_CONFIRMATION: 'sans_confirmation',
};

/**
 * Signes d'un contrôle anti-robot sur la page.
 *
 * On se contente de **constater** : un captcha est une barrière posée
 * volontairement, la contourner n'est pas au programme. Le nommer permet en
 * revanche d'arrêter proprement, de ne pas compter l'offre comme perdue, et de
 * proposer la reprise en main — le seul chemin qui aboutisse réellement.
 */
const MARQUEURS_CAPTCHA = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[title*="captcha" i]',
  'div.g-recaptcha',
  'div.h-captcha',
  '#cf-challenge-running',
  '[data-cy="captcha"]',
  'iframe[src*="datadome"]',
  '#px-captcha',
];

const TEXTE_CAPTCHA =
  /captcha|je ne suis pas un robot|i'm not a robot|v[ée]rifi(ez|cation) que vous [êe]tes (un )?humain|verify you are human|contr[ôo]le de s[ée]curit[ée]|acc[èe]s refus[ée].{0,40}robot/i;

/**
 * La page est-elle bloquée par un contrôle anti-robot ?
 *
 * Deux sondes, parce qu'aucune ne suffit : le marqueur technique attrape les
 * widgets connus, le texte attrape les pages de contrôle maison qui n'en
 * utilisent aucun. On borne la lecture du texte au corps visible — le mot
 * « captcha » traîne dans les scripts de la moitié des sites.
 */
export async function captchaPresent(page) {
  for (const marqueur of MARQUEURS_CAPTCHA) {
    const vu = await page
      .locator(marqueur)
      .first()
      .isVisible()
      .catch(() => false);
    if (vu) return true;
  }

  const texte = await page.innerText('body').catch(() => '');
  return TEXTE_CAPTCHA.test(texte.slice(0, 4000));
}

/**
 * Clé stable pour une question de formulaire, dérivée de son libellé.
 *
 * « Années d'expérience », « Annees d'experience » et « ANNÉES D'EXPÉRIENCE  »
 * doivent désigner la même question : sans normalisation, la même demande
 * reviendrait sous trois entrées et l'utilisateur y répondrait trois fois.
 */
export function cleQuestion(libelle) {
  return stripAccents(libelle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}
