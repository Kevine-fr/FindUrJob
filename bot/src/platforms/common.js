/**
 * Socle commun aux plateformes sans API.
 *
 * Les offres sorties d'ici ont exactement la forme attendue par
 * `server/src/controllers/offerController.js` (`sanitize`) — le vocabulaire est
 * le même que celui du moteur Python (`ai/app/sources/base.py`), pour qu'une
 * offre scrapée et une offre d'API soient indistinguables en base.
 */

export const stripAccents = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // les diacritiques, une fois détachés

const REMOTE_HINTS = ['teletravail', '100% remote', 'full remote', 'remote', 'a distance', 'distanciel'];
const HYBRID_HINTS = ['hybride', 'partiel', 'hybrid', '2 jours', '3 jours'];

export function guessRemote(...texts) {
  const blob = stripAccents(texts.filter(Boolean).join(' ')).toLowerCase();
  if (HYBRID_HINTS.some((hint) => blob.includes(hint))) return 'hybride';
  if (REMOTE_HINTS.some((hint) => blob.includes(hint))) return 'teletravail';
  return 'non_precise';
}

export function guessContract(...texts) {
  const blob = stripAccents(texts.filter(Boolean).join(' ')).toLowerCase().replace(/_/g, ' ');
  if (/alternance|apprentissage|apprentice/.test(blob)) return 'alternance';
  if (/stage|internship|stagiaire/.test(blob)) return 'stage';
  if (/freelance|independant|contractor|mission/.test(blob)) return 'freelance';
  if (/\bcdd\b|temporary|fixed[- ]term|interim|intérim/.test(blob)) return 'cdd';
  if (/\bcdi\b|permanent|full[- ]time|temps plein/.test(blob)) return 'cdi';
  return 'autre';
}

/** HTML → texte lisible. Les annonces arrivent presque toujours en HTML. */
export function cleanHtml(raw) {
  if (!raw) return '';
  let text = String(raw)
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '');

  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&ccedil;': 'ç',
  };
  for (const [entity, char] of Object.entries(entities)) text = text.split(entity).join(char);
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Ramène une offre à la forme du modèle `JobOffer`. */
export function normalize(offer, source) {
  const description = cleanHtml(offer.description || '');
  return {
    title: cleanHtml(offer.title || '').trim(),
    company: cleanHtml(offer.company || '').trim(),
    location: cleanHtml(offer.location || '').trim(),
    source,
    sourceUrl: String(offer.sourceUrl || '').trim(),
    externalId: String(offer.externalId || '').trim(),
    description,
    contractType:
      offer.contractType || guessContract(offer.contractHint, offer.title, description.slice(0, 400)),
    remote: offer.remote || guessRemote(offer.title, offer.location, description),
    salary: cleanHtml(offer.salary || '').trim(),
    keywords: (offer.keywords || []).filter((word) => typeof word === "string").slice(0, 12),
    publishedAt: offer.publishedAt || undefined,
    applicantCount: Number.isFinite(Number(offer.applicantCount)) ? Number(offer.applicantCount) : null,
  };
}

/**
 * Offres décrites en JSON-LD (schema.org/JobPosting).
 *
 * C'est la voie la plus stable : beaucoup de sites d'emploi publient ce bloc
 * pour Google, et il bouge bien moins souvent que leurs classes CSS. On l'essaie
 * avant de tomber sur les sélecteurs.
 */
export async function jsonLdJobs(page) {
  return page.evaluate(() => {
    const found = [];

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);

      const type = [].concat(node['@type'] || []);
      if (type.includes('JobPosting')) {
        const place = node.jobLocation?.address || node.jobLocation?.[0]?.address || {};
        found.push({
          title: node.title || '',
          company: node.hiringOrganization?.name || '',
          location: [place.addressLocality, place.addressRegion].filter(Boolean).join(', '),
          description: node.description || '',
          sourceUrl: node.url || location.href,
          externalId: String(node.identifier?.value || node.identifier || ''),
          contractHint: [].concat(node.employmentType || []).join(' '),
          salary: node.baseSalary?.value?.value
            ? String(node.baseSalary.value.value)
            : node.baseSalary?.value?.minValue
              ? `${node.baseSalary.value.minValue} – ${node.baseSalary.value.maxValue || ''}`
              : '',
        });
      }
      Object.values(node).forEach(visit);
    };

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(script.textContent));
      } catch {
        /* bloc malformé : on passe au suivant */
      }
    }
    return found;
  });
}

/** Le premier sélecteur qui donne du texte gagne. */
export const textFrom = (root, selectors) => {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const text = node?.getAttribute?.('title') || node?.textContent;
    if (text && text.trim()) return text.trim();
  }
  return '';
};

/**
 * « il y a 3 jours », « 2 weeks ago », « 5 h » → date absolue.
 *
 * Les plateformes affichent presque toujours une ancienneté relative plutôt
 * qu'une date. La convertir tout de suite évite d'avoir à réinterpréter
 * « hier » des semaines plus tard, quand il ne veut plus rien dire.
 */
export function parseRelativeDate(texte) {
  const t = stripAccents(String(texte || "")).toLowerCase();
  if (!t) return undefined;

  const m = /(\d+)\s*(minute|min|heure|hour|h|jour|day|j|semaine|week|mois|month|an|year)/.exec(t);
  if (!m) return /aujourd|today|instant|just now/.test(t) ? new Date() : undefined;

  const n = Number(m[1]);
  const unites = {
    minute: 60e3, min: 60e3,
    heure: 3600e3, hour: 3600e3, h: 3600e3,
    jour: 864e5, day: 864e5, j: 864e5,
    semaine: 6048e5, week: 6048e5,
    mois: 2592e6, month: 2592e6,
    an: 31536e6, year: 31536e6,
  };
  const ms = unites[m[2]];
  return ms ? new Date(Date.now() - n * ms) : undefined;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Écarte la bannière de consentement (RGPD).
 *
 * Sans ça, l'overlay recouvre le formulaire : le champ existe dans le DOM mais
 * n'est pas cliquable, et Playwright attend en vain jusqu'au délai maximal —
 * l'erreur ressemble alors à un mauvais sélecteur, alors que c'est un rideau.
 *
 * On refuse le pistage quand le site le propose : c'est le choix le plus sobre,
 * et il suffit pour accéder au formulaire.
 */
/**
 * La session de cette plateforme est-elle réellement ouverte ?
 *
 * Le piège est toujours le même : on demande la page de l'espace personnel, la
 * plateforme redirige vers son service d'authentification, et l'on juge l'URL
 * **avant** que cette redirection n'aboutisse. C'est ce qui arrivait à France
 * Travail : sa session était morte depuis des jours, l'application l'affichait
 * « connectée », et les candidatures échouaient sans que rien ne l'explique.
 * Pire, la relance automatique de session ne se déclenchait jamais, puisque
 * personne ne signalait le problème.
 *
 * Deux vérifications, donc, et l'une ne remplace pas l'autre : l'adresse une
 * fois la navigation posée, et la présence d'un champ de mot de passe visible —
 * signe qu'on regarde un écran de connexion, quelle que soit l'URL.
 *
 * @param motifHorsSession Ce qu'on lit dans l'URL quand la session est fermée.
 */
export async function sessionOuverte(page, url, motifHorsSession) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Les redirections d'authentification sont des navigations à part entière.
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});

  if (motifHorsSession.test(page.url())) return false;

  const formulaireDeConnexion = await page
    .evaluate(() => {
      const champ = document.querySelector('input[type="password"]');
      return Boolean(champ && (champ.offsetParent !== null || champ.getClientRects().length > 0));
    })
    .catch(() => false);

  return !formulaireDeConnexion;
}

/*
 * Deux familles de libellés, dans cet ordre : on refuse quand c'est proposé, on
 * n'accepte qu'à défaut. « Non merci » est le refus d'Axeptio, « OK pour moi »
 * son acceptation — c'est le bandeau de Welcome to the Jungle.
 */
const CONSENT_REFUS =
  /^\s*(continuer sans accepter|non merci|tout refuser|refuser(\s+tout)?|continue without accepting|reject all|decline)\s*$/i;
const CONSENT_ACCEPT =
  /^\s*(ok pour moi|tout accepter|accepter(\s+tout)?|accept all|j['’]accepte|i agree)\s*$/i;

/**
 * Ferme le bandeau de consentement, s'il y en a un.
 *
 * Trois pièges, rencontrés en vrai :
 *
 *   1. **Le bandeau arrive tard.** Celui de Welcome to the Jungle est injecté
 *      par un script tiers et n'existe pas encore une seconde après le
 *      chargement. Une attente fixe de 900 ms le manquait, et la page restait
 *      recouverte : le clic sur « Postuler » n'atteignait jamais rien. D'où la
 *      scrutation, plutôt qu'un délai deviné.
 *   2. **Il vit parfois dans un cadre embarqué**, hors de la page principale.
 *   3. **Il vit parfois dans un shadow DOM** — Playwright le traverse, un
 *      `querySelector` non.
 *
 * Rend le libellé du bouton actionné, ou `null` s'il n'y avait rien à fermer.
 */
export async function dismissConsent(page, { timeout = 8000 } = {}) {
  const echeance = Date.now() + timeout;

  while (Date.now() < echeance) {
    for (const cadre of page.frames()) {
      for (const motif of [CONSENT_REFUS, CONSENT_ACCEPT]) {
        const bouton = cadre
          .locator('button, [role="button"], a')
          .filter({ hasText: motif })
          .first();
        try {
          // `isVisible()` sans option n'attend pas : sur une page sans bandeau,
          // la boucle tourne à vide sans rien coûter.
          if (await bouton.isVisible()) {
            const libelle = (await bouton.innerText().catch(() => '')).trim();
            await bouton.click({ timeout: 3000 });
            await sleep(700);
            return libelle || 'consentement';
          }
        } catch {
          // Cadre détaché ou bouton disparu entre-temps : on repasse.
        }
      }
    }
    await sleep(400);
  }
  return null;
}

/**
 * Cadence humaine entre deux actions.
 *
 * Ce n'est pas un contournement : c'est la contrepartie du choix assumé de
 * candidater en petit volume. Un enchaînement à pleine vitesse dégrade la
 * qualité des candidatures autant qu'il attire l'attention.
 */
export const humanPause = (min = 900, max = 2400) =>
  sleep(min + Math.floor(Math.random() * (max - min)));
