import { normalize, humanPause, dismissConsent, parseRelativeDate } from './common.js';

/**
 * Indeed.
 *
 * L'API Publisher a fermé en 2023 : il ne reste que le site. Indeed est aussi
 * la plateforme la mieux protégée des trois — une session persistante et une
 * cadence lente changent tout, mais un blocage reste possible. Dans ce cas on
 * remonte l'information au lieu de renvoyer une liste vide, sinon l'utilisateur
 * croit simplement qu'il n'y a pas d'offres.
 */

const PER_PAGE = 15; // pas de pagination d'Indeed

export const name = 'indeed';
export const loginUrl = 'https://secure.indeed.com/auth';
export const needsSessionToSearch = false;

const domain = () => process.env.INDEED_DOMAIN || 'fr.indeed.com';

function searchUrl({ keywords = [], location = '', remotes = [] }, start) {
  const params = new URLSearchParams();
  if (keywords.length) params.set('q', keywords.join(' '));
  if (location) params.set('l', location);
  if (start) params.set('start', String(start));
  if (remotes.includes('teletravail')) params.set('sc', '0kf:attr(DSQF7)'); // filtre « télétravail »
  return `https://${domain()}/jobs?${params}`;
}

// Indeed sert une page 403 « Security Check » plutôt qu'un blocage franc :
// sans ces marqueurs, le scraper lit une page valide, n'y trouve aucune carte,
// et rapporte « 0 offre » — ce qui se confond avec « aucun résultat ».
const BLOCK_MARKERS = [
  'cf-challenge',
  'px-captcha',
  'Security Check',
  'Vérification supplémentaire requise',
  'additional verification',
  'Vérifiez que vous êtes',
];

async function isBlocked(page, response) {
  if (response && [403, 429].includes(response.status())) return true;
  const title = await page.title().catch(() => '');
  const body = await page.content().catch(() => '');
  return BLOCK_MARKERS.some((marker) => title.includes(marker) || body.includes(marker));
}

async function readCards(page) {
  return page.evaluate(() => {
    const text = (root, selectors) => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        const value = node?.getAttribute?.('title') || node?.textContent;
        if (value?.trim()) return value.trim();
      }
      return '';
    };

    const cards = document.querySelectorAll('.job_seen_beacon, [data-testid="slider_item"]');
    return [...cards]
      .map((card) => {
        const link = card.querySelector('a[data-jk], a.jcs-JobTitle');
        // `data-jk` est l'identifiant fiable : sur une annonce sponsorisée, le
        // href pointe vers /pagead/clk et ne contient aucun identifiant lisible.
        const jk = link?.getAttribute('data-jk') || link?.href?.match(/[?&]jk=([a-f0-9]+)/)?.[1] || '';

        return {
          // Le titre a migré de h2 vers h3 ; on garde les deux, plus le
          // span[title] du lien qui survit aux réorganisations de balises.
          title: text(card, [
            'h3.jobTitle span[title]',
            'a[data-jk] span[title]',
            'h3.jobTitle',
            'h2.jobTitle span[title]',
            'h2.jobTitle',
            '[data-testid="jobTitle"]',
          ]),
          company: text(card, ['[data-testid="company-name"]', '.companyName', '.company_location a']),
          location: text(card, ['[data-testid="text-location"]', '.companyLocation']),
          salary: text(card, ['[data-testid="attribute_snippet_testid"]', '.salary-snippet-container']),
          description: text(card, ["[data-testid=\"belowJobSnippet\"]", ".job-snippet"]),
          publishedRaw: text(card, ["[data-testid=\"myJobsStateDate\"]", ".date"]),
          externalId: jk,
          sourceUrl: jk ? `${location.origin}/viewjob?jk=${jk}` : link?.href || '',
        };
      })
      .filter((card) => card.title && card.externalId);
  });
}

export async function search(context, query) {
  const wanted = Math.min(Math.max(1, query.limit || 25), 150);
  const page = await context.newPage();
  const collected = [];
  const seen = new Set();

  try {
    for (let start = 0; collected.length < wanted && start < wanted + PER_PAGE; start += PER_PAGE) {
      const response = await page.goto(searchUrl(query, start), {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });

      if (await isBlocked(page, response)) {
        if (collected.length) break;
        throw new Error(
          "Indeed a opposé une vérification anti-robot (Cloudflare). Ouvre une session " +
            "Indeed depuis l'onglet Comptes — une session authentifiée passe le contrôle — " +
            'puis relance la recherche.'
        );
      }

      await page.waitForSelector('.job_seen_beacon, [data-testid="slider_item"]', { timeout: 10_000 })
        .catch(() => {});

      const cards = await readCards(page);
      if (!cards.length) break;

      for (const card of cards) {
        if (seen.has(card.externalId)) continue;
        seen.add(card.externalId);
        collected.push(card);
      }
      await humanPause(1200, 2600);
    }

    return collected
      .slice(0, wanted)
      .map((card) => normalize({ ...card, publishedAt: parseRelativeDate(card.publishedRaw) }, name));
  } finally {
    await page.close().catch(() => {});
  }
}

export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    await page.goto(`https://${domain()}/myjobs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    return !/secure\.indeed\.com|\/auth/.test(page.url());
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function login(context, { email, password }) {
  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await dismissConsent(page);
    await page.fill('input[type="email"], #ifl-InputFormField-3', email);
    await humanPause(400, 900);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Indeed privilégie le lien magique : le champ mot de passe n'apparaît pas
    // toujours. Quand il manque, seul l'utilisateur peut finir la connexion.
    const passwordField = page.locator('input[type="password"]');
    if (await passwordField.count()) {
      await passwordField.fill(password);
      await humanPause(400, 900);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    }

    if (/auth|captcha|challenge/.test(page.url())) {
      return {
        status: 'verification',
        message:
          'Indeed demande une vérification (code par e-mail ou captcha). ' +
          'Termine-la dans la fenêtre du bot.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        url: page.url(),
      };
    }
    return { status: 'connected', message: 'Session Indeed ouverte.', url: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function apply(context, offer) {
  const page = await context.newPage();
  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'domcontentloaded' });
    await humanPause();

    const button = page.locator('#indeedApplyButton, [data-testid="indeedApplyButton"]').first();
    if (!(await button.count())) {
      return { status: 'manual', message: "Cette offre renvoie vers le site de l'entreprise." };
    }

    // Le formulaire « Indeed Apply » vit dans une iframe et enchaîne des écrans
    // dont le contenu dépend de l'employeur : on ne le devine pas.
    await button.click();
    await humanPause(1500, 2500);
    return {
      status: 'manual',
      message: "Formulaire Indeed Apply ouvert : à finir à la main (questions propres à l'employeur).",
      screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
    };
  } finally {
    await page.close().catch(() => {});
  }
}
