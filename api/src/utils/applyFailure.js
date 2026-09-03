/**
 * Ce qu'on sait d'un échec de candidature.
 *
 * Le robot rend un code (voir `bot/src/platforms/failures.js`) ; cette table
 * dit ce qu'il signifie, s'il se répare, et s'il vaut la peine d'être retenté.
 * Elle vit côté API parce que c'est ici qu'on décide — le robot, lui, n'a qu'à
 * constater.
 *
 * Deux propriétés portent toute la logique de reprise :
 *
 *   `reparable`  — une information manquante que la personne peut fournir. Ces
 *                  échecs-là alimentent la page « Informations demandées », et
 *                  disparaissent une fois la réponse donnée.
 *
 *   `retentable` — relancer la même candidature a une chance d'aboutir. Un
 *                  captcha ne l'est pas : réessayer se heurtera au même mur.
 *                  Une redirection vers l'ATS de l'employeur non plus — il n'y
 *                  a rien à retenter ici, la candidature se fait ailleurs.
 */

export const RAISONS_ECHEC = {
  captcha: {
    label: 'Contrôle anti-robot',
    explication:
      "La plateforme oppose un captcha. C'est une barrière posée volontairement : aucune " +
      'automatisation ne la franchit.',
    action: 'Terminer la candidature depuis la reprise en main, dans l’onglet Comptes.',
    reparable: false,
    retentable: false,
  },
  champs_manquants: {
    label: 'Informations manquantes',
    explication:
      "Le formulaire exige des champs qu'on ne savait pas remplir — souvent propres à " +
      "l'employeur (années d'expérience, prétentions, préavis).",
    action: 'Répondre aux questions dans « Informations demandées », puis relancer.',
    reparable: true,
    retentable: true,
  },
  cv_refuse: {
    label: 'CV refusé',
    explication: "Le fichier a été déposé mais la plateforme ne l'a pas accepté.",
    action: 'Vérifier le format et le poids du CV généré.',
    reparable: false,
    retentable: true,
  },
  cv_sans_champ: {
    label: 'Aucun champ pour le CV',
    explication:
      "Le formulaire n'offre nulle part où joindre le CV : la candidature partirait sans le " +
      "document reciblé, ce qui lui retire l'essentiel de sa valeur.",
    action: 'Candidater à la main pour joindre le CV.',
    reparable: false,
    retentable: true,
  },
  formulaire_absent: {
    label: 'Formulaire introuvable',
    explication:
      "Aucun formulaire de candidature sur la page. Souvent le signe d'une refonte du site, " +
      "ou d'une annonce qui redirige ailleurs.",
    action: 'Ouvrir l’annonce pour voir ce qu’elle attend.',
    reparable: false,
    retentable: true,
  },
  bouton_absent: {
    label: 'Bouton d’envoi introuvable',
    explication: "Le formulaire a été rempli, mais rien ne permet de l'envoyer.",
    action: 'Ouvrir l’annonce et terminer à la main.',
    reparable: false,
    retentable: true,
  },
  redirection_externe: {
    label: 'Candidature hors plateforme',
    explication:
      "L'annonce renvoie vers l'outil de recrutement de l'employeur. On ne suit pas ces liens : " +
      'chaque outil a son parcours, et candidater à l’aveugle sur un site tiers revient à envoyer ' +
      'n’importe quoi.',
    action: 'Ouvrir le lien du recruteur et candidater là-bas.',
    reparable: false,
    retentable: false,
  },
  plateforme_bloquee: {
    label: 'Plateforme bloquante',
    explication: 'La plateforme refuse le navigateur piloté.',
    action: 'Passer par la reprise en main.',
    reparable: false,
    retentable: false,
  },
  session_expiree: {
    label: 'Session expirée',
    explication: 'La session de la plateforme n’était plus valide au moment de l’envoi.',
    action: 'Rouvrir la session dans l’onglet Comptes, puis relancer.',
    reparable: false,
    retentable: true,
  },
  offre_disparue: {
    label: 'Annonce retirée',
    explication: 'L’annonce n’existait plus au moment de candidater.',
    action: 'Rien à faire : l’offre est close.',
    reparable: false,
    retentable: false,
  },
  reseau: {
    label: 'Incident réseau',
    explication: 'Délai dépassé ou coupure. Rien ne dit que la plateforme soit en cause.',
    action: 'Relancer : c’est le cas où réessayer suffit le plus souvent.',
    reparable: false,
    retentable: true,
  },
  post_envoi_incomplet: {
    label: 'Questionnaire après envoi',
    explication:
      'La candidature a été soumise, puis un questionnaire complémentaire est resté incomplet. ' +
      'Le dossier est probablement arrivé.',
    action: 'Vérifier sur la plateforme avant toute nouvelle tentative.',
    reparable: true,
    retentable: false,
  },
  sans_confirmation: {
    label: 'Sans confirmation',
    explication:
      "Le bouton a été actionné, la plateforme n'a rien confirmé. La candidature est peut-être " +
      'partie — c’est le cas qui produit les doubles envois.',
    action: 'Vérifier sur la plateforme avant toute nouvelle tentative.',
    reparable: false,
    retentable: false,
  },
  inconnu: {
    label: 'Cause non identifiée',
    explication: 'Le robot n’a pas su nommer ce qui a bloqué.',
    action: 'Regarder la capture d’écran de la tentative.',
    reparable: false,
    retentable: true,
  },
};

export const CODES_ECHEC = Object.keys(RAISONS_ECHEC);

/**
 * Retrouve un code à partir d'un message libre.
 *
 * Les candidatures déjà en base n'ont qu'une phrase française : sans cette
 * traduction, tout l'historique resterait « cause non identifiée » et les
 * statistiques ne commenceraient qu'aujourd'hui. Les motifs reprennent les
 * messages réellement produits par le robot jusqu'ici.
 */
const EMPREINTES = [
  [/captcha|anti-robot|pas un robot/i, 'captcha'],
  [/champs? obligatoires? non renseign/i, 'champs_manquants'],
  [/cv non accept/i, 'cv_refuse'],
  [/aucun champ pour joindre le cv/i, 'cv_sans_champ'],
  [/aucun formulaire/i, 'formulaire_absent'],
  [/bouton d'envoi introuvable/i, 'bouton_absent'],
  [/site du recruteur|hors plateforme|ats|redirig/i, 'redirection_externe'],
  [/refuse le navigateur|bloqu/i, 'plateforme_bloquee'],
  [/session (expir|ferm)/i, 'session_expiree'],
  [/annonce (retir|introuvable|ferm)|offre .*(retir|disparu)/i, 'offre_disparue'],
  [/timeout|d[ée]lai d[ée]pass|econnrefused|réseau|network/i, 'reseau'],
  [/[ée]tape .* rest[ée]e incompl/i, 'post_envoi_incomplet'],
  [/sans confirmation/i, 'sans_confirmation'],
];

export function deviner(message) {
  const texte = String(message || '');
  return EMPREINTES.find(([motif]) => motif.test(texte))?.[1] || 'inconnu';
}

/** Les métadonnées d'un code, avec repli sur « inconnu ». */
export const infoEchec = (code) => RAISONS_ECHEC[code] || RAISONS_ECHEC.inconnu;
