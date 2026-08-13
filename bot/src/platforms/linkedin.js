import { normalize, cleanHtml, humanPause, dismissConsent } from './common.js';

/**
 * LinkedIn.
 *
 * La recherche passe par les points d'entrée « invité » que LinkedIn sert aux
 * moteurs de recherche : ils rendent le même HTML que la page publique d'une
 * offre, sans session, et bougent bien moins souvent que l'application
 * connectée. La session ne redevient nécessaire que pour candidater.
 */

const GUEST_SEARCH =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PER_PAGE = 25; // imposé par le point d'entrée

export const name = 'linkedin';
export const loginUrl = 'https://www.linkedin.com/login';
export const needsSessionToSearch = false;

const REMOTE_FILTER = { teletravail: '2', hybride: '3', sur_site: '1' };
const CONTRACT_FILTER = {
  cdi: 'F', // full-time
  cdd: 'C', // contract
  stage: 'I', // internship
  alternance: 'P', // part-time, le plus proche côté LinkedIn
  freelance: 'C',
};

function searchUrl({ keywords = [], location = '', contractTypes = [], remotes = [] }, start) {
  const params = new URLSearchParams({ start: String(start) });
  if (keywords.length) params.set('keywords', keywords.join(' '));
  if (location) params.set('location', location);

  const jobTypes = contractTypes.map((type) => CONTRACT_FILTER[type]).filter(Boolean);
  if (jobTypes.length) params.set('f_JT', [...new Set(jobTypes)].join(','));

  const workplace = remotes.map((mode) => REMOTE_FILTER[mode]).filter(Boolean);
  if (workplace.length) params.set('f_WT', workplace.join(','));

  return `${GUEST_SEARCH}?${params}`;
}

/** Extrait les cartes du fragment HTML renvoyé par la recherche invité. */
async function readCards(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('li, div.base-card');
    return [...cards]
      .map((card) => {
        const link = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]');
        const href = link?.href || '';
        const id = href.match(/-(\d+)(?:\?|$)/)?.[1] || href.match(/currentJobId=(\d+)/)?.[1] || '';
        const text = (selector) => card.querySelector(selector)?.textContent?.trim() || '';
        return {
          title: text('.base-search-card__title, h3'),
          company: text('.base-search-card__subtitle, h4'),
          location: text('.job-search-card__location'),
          salary: text('.job-search-card__salary-info'),
          sourceUrl: href.split('?')[0],
          externalId: id,
        };
      })
      .filter((card) => card.title && card.externalId);
  });
}

/** La description ne vient pas avec la liste : elle demande une page par offre. */
async function fetchDescription(page, offerId) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${offerId}`;
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!response?.ok()) return { description: '', contractHint: '' };

    return await page.evaluate(() => {
      const block = document.querySelector('.description__text, .show-more-less-html__markup');
      const criteria = [...document.querySelectorAll('.description__job-criteria-item')].map(
        (item) => item.textContent.replace(/\s+/g, ' ').trim()
      );
      return { description: block?.innerHTML || '', contractHint: criteria.join(' · ') };
    });
  } catch {
    return { description: '', contractHint: '' };
  }
}

export async function search(context, query) {
  const limit = Math.max(1, query.limit || 25);
  const wanted = Math.min(limit, 200);
  const page = await context.newPage();
  const collected = [];
  const seen = new Set();

  try {
    for (let start = 0; collected.length < wanted && start < wanted + PER_PAGE; start += PER_PAGE) {
      const response = await page.goto(searchUrl(query, start), {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });

      // 429 : on a demandé trop vite. Inutile d'insister, on rend ce qu'on a.
      if (response && [403, 429].includes(response.status())) {
        if (!collected.length) throw new Error(`LinkedIn limite les requêtes (${response.status()})`);
        break;
      }

      const cards = await readCards(page);
      if (!cards.length) break;

      for (const card of cards) {
        if (seen.has(card.externalId)) continue;
        seen.add(card.externalId);
        collected.push(card);
      }
      await humanPause(600, 1500);
    }

    // Les descriptions coûtent une requête chacune : on ne les charge que pour
    // ce qu'on va réellement garder.
    const kept = collected.slice(0, wanted);
    for (const card of kept) {
      const detail = await fetchDescription(page, card.externalId);
      Object.assign(card, detail);
      await humanPause(400, 1100);
    }

    return kept.map((card) => normalize(card, name));
  } finally {
    await page.close().catch(() => {});
  }
}

export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    return !/\/(login|uas\/login|checkpoint)/.test(page.url());
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Connexion assistée : on remplit le formulaire, puis on rend la main si
 * LinkedIn demande une vérification. On ne cherche jamais à la franchir.
 */
export async function login(context, { email, password }) {
  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await dismissConsent(page);
    await page.fill('#username', email);
    await humanPause(300, 800);
    await page.fill('#password', password);
    await humanPause(300, 800);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const url = page.url();
    if (/checkpoint|challenge/.test(url)) {
      return {
        status: 'verification',
        message:
          "LinkedIn demande une vérification (2FA, code e-mail ou captcha). " +
          'Termine-la dans la fenêtre du bot : la session restera ouverte ensuite.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        url,
      };
    }
    if (/\/login/.test(url)) {
      const error = await page
        .locator('.form__label--error, [error-for], .alert')
        .first()
        .textContent()
        .catch(() => null);
      return { status: 'failed', message: cleanHtml(error || 'Identifiants refusés.'), url };
    }
    return { status: 'connected', message: 'Session LinkedIn ouverte.', url };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Candidature.
 *
 * Seules les offres « Candidature simplifiée » sont automatisables : les autres
 * renvoient vers le site de l'entreprise, où il n'y a pas de formulaire commun.
 * On le dit plutôt que de faire semblant.
 */
export async function apply(context, offer, { cvFile } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'domcontentloaded' });
    await humanPause();

    const easyApply = page.locator('button.jobs-apply-button').first();
    if (!(await easyApply.count())) {
      return { status: 'manual', message: "Cette offre n'a pas de candidature simplifiée." };
    }

    await easyApply.click();
    await page.waitForSelector('.jobs-easy-apply-modal', { timeout: 15_000 });

    if (cvFile) {
      const upload = page.locator('input[type="file"]').first();
      if (await upload.count()) await upload.setInputFiles(cvFile).catch(() => {});
    }

    // Le formulaire est multi-étapes et son contenu varie selon l'entreprise :
    // on avance tant qu'il n'y a qu'un bouton « suivant » à cliquer.
    for (let step = 0; step < 6; step++) {
      await humanPause();
      const submit = page.locator('button[aria-label*="Envoyer"], button[aria-label*="Submit"]');
      if (await submit.count()) {
        await submit.first().click();
        await humanPause(1500, 2500);
        return { status: 'sent', message: 'Candidature envoyée.' };
      }
      const next = page.locator('button[aria-label*="suivant"], button[aria-label*="next"]');
      if (!(await next.count())) break;
      await next.first().click();
    }

    return {
      status: 'manual',
      message: 'Le formulaire demande des réponses spécifiques : à terminer à la main.',
      screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
    };
  } finally {
    await page.close().catch(() => {});
  }
}
