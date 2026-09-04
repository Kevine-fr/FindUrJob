import { normalize, humanPause, dismissConsent, sessionOuverte } from './common.js';
import { applyForm, externalApplyUrl } from './applyForm.js';
import { RAISONS } from './failures.js';

/**
 * Welcome to the Jungle.
 *
 * La recherche du site s'appuie sur Algolia. La clé publique est restreinte au
 * référent : appelée depuis Node elle renvoie 403, appelée depuis une page
 * welcometothejungle.com elle répond normalement. On passe donc par le
 * navigateur — ce n'est pas un contournement, c'est le chemin prévu.
 *
 * Les identifiants sont publics (ils voyagent dans le JavaScript du site) mais
 * peuvent changer : on les relit dans les requêtes de la page plutôt que de les
 * figer ici.
 */

const INDEX = 'wk_cms_jobs_production';
const PER_PAGE = 30;

export const name = 'welcometothejungle';
export const loginUrl = 'https://www.welcometothejungle.com/fr/signin';
export const needsSessionToSearch = false;

// Valeurs relevées sur le site ; servent de repli si la capture échoue.
const FALLBACK = { appId: 'CSEKHVMS53', apiKey: '4bd8f6215d0cc52b26430765769e65a0' };

/** Récupère les identifiants Algolia dans les appels réels de la page. */
async function captureCredentials(page) {
  const seen = { ...FALLBACK };
  page.on('request', (request) => {
    if (!/algolia/i.test(request.url())) return;
    const headers = request.headers();
    if (headers['x-algolia-api-key']) seen.apiKey = headers['x-algolia-api-key'];
    if (headers['x-algolia-application-id']) seen.appId = headers['x-algolia-application-id'];
  });
  return seen;
}

export async function search(context, query) {
  const wanted = Math.min(Math.max(1, query.limit || 25), 150);
  const page = await context.newPage();

  try {
    const creds = await captureCredentials(page);
    await page.goto('https://www.welcometothejungle.com/fr/jobs', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    // Laisse la page émettre ses propres requêtes : c'est là qu'on relit la clé.
    await page.waitForTimeout(3500);

    const collected = [];

    for (let pageIndex = 0; collected.length < wanted; pageIndex++) {
      const batch = await page.evaluate(
        async ([index, appId, apiKey, texte, lieu, taille, numero]) => {
          const url = `https://${appId}-dsn.algolia.net/1/indexes/${index}/query`;
          const filtres = lieu ? `offices.city:"${lieu}"` : '';
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'X-Algolia-API-Key': apiKey,
              'X-Algolia-Application-Id': appId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: texte,
              hitsPerPage: taille,
              page: numero,
              ...(filtres ? { filters: filtres } : {}),
            }),
          });
          if (!response.ok) return { erreur: `HTTP ${response.status}` };
          return response.json();
        },
        [
          INDEX,
          creds.appId,
          creds.apiKey,
          (query.keywords || []).join(' '),
          String(query.location || '').split(/[-,]/)[0].trim(),
          PER_PAGE,
          pageIndex,
        ]
      );

      if (batch?.erreur) {
        if (collected.length) break;
        throw new Error(
          `Welcome to the Jungle a refusé la recherche (${batch.erreur}). ` +
            'La clé publique du site a probablement changé.'
        );
      }

      const hits = batch?.hits || [];
      if (!hits.length) break;
      collected.push(...hits);

      if (hits.length < PER_PAGE || pageIndex + 1 >= (batch.nbPages || 1)) break;
      await humanPause(400, 1000);
    }

    return collected.slice(0, wanted).map((hit) => {
      const bureau = hit.offices?.[0] || {};
      const societe = hit.organization?.name || hit.organization_name || '';
      const slugSociete = hit.organization?.slug || hit.organization_slug || '';

      return normalize(
        {
          title: hit.name || hit.title || '',
          company: societe,
          location: [bureau.city, bureau.country].filter(Boolean).join(', '),
          description: hit.description || hit.profile || '',
          externalId: String(hit.objectID || hit.reference || ''),
          sourceUrl:
            slugSociete && hit.slug
              ? `https://www.welcometothejungle.com/fr/companies/${slugSociete}/jobs/${hit.slug}`
              : '',
          contractHint: hit.contract_type || "",
          publishedAt: hit.published_at
            ? new Date(typeof hit.published_at === "number" ? hit.published_at * 1000 : hit.published_at)
            : undefined,
          remote: /full|fulltime|total/i.test(hit.remote || '') ? 'teletravail' : undefined,
        },
        name
      );
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * La session se lit sur le tableau de bord candidat : sans elle, le site
 * renvoie vers `/authenticate/signin`.
 */
export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    return await sessionOuverte(
      page,
      'https://www.welcometothejungle.com/fr/me/applications',
      /\/signin|\/authenticate|\/login/
    );
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function login(context, { email, password }) {
  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: 'commit', timeout: 45_000 });
    await dismissConsent(page);
    await humanPause();

    // Champs relevés sur la page : `session.email` / `session.password`.
    await page.fill('input[name="session.email"], input[type="email"]', email);
    await humanPause(300, 700);
    await page.fill('input[name="session.password"], input[type="password"]', password);
    await humanPause(300, 700);

    await page.getByRole('button', { name: /se connecter|log ?in|sign ?in/i }).first().click();
    await page.waitForTimeout(6000);

    if (/\/signin|\/authenticate/.test(page.url())) {
      return {
        status: 'manual',
        message:
          'Welcome to the Jungle refuse la connexion automatique (vérification en cours). ' +
          'Termine-la depuis la reprise en main.',
      };
    }
    return { status: 'connected', message: 'Session Welcome to the Jungle ouverte.' };
  } catch (error) {
    return { status: 'manual', message: `Connexion WTTJ : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Candidature.
 *
 * Beaucoup d'annonces WTTJ ne sont qu'une vitrine : « Postuler » renvoie vers
 * l'ATS de l'employeur (contactrh, Greenhouse, Lever…), chacun avec son propre
 * parcours. On ne les suit pas — on le dit, avec l'adresse, pour que la
 * candidature se termine à la main en connaissance de cause. Les annonces
 * hébergées par WTTJ, elles, se remplissent normalement.
 */
export async function apply(context, offer, options = {}) {
  const page = await context.newPage();
  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'commit', timeout: 45_000 });
    await dismissConsent(page);
    await page.waitForTimeout(3000);

    const externe = await externalApplyUrl(page, 'welcometothejungle.com');
    if (externe) {
      return {
        status: 'external',
        reason: RAISONS.REDIRECTION_EXTERNE,
        message: `L'employeur reçoit les candidatures sur son propre site : ${externe}`,
        externalUrl: externe,
      };
    }

    /*
     * « Postuler » est un **bouton**, pas un lien.
     *
     * Ne chercher qu'un lien ne cliquait rien : le formulaire ne s'ouvrait
     * jamais, et le remplisseur se rabattait sur un dialogue vide de la page,
     * d'où un « bouton d'envoi introuvable » qui n'avait aucun rapport. Le
     * motif est ancré sur le mot seul — « L'envoi d'un CV est-il obligatoire
     * pour postuler ? » est une question de la FAQ, pas une action.
     */
    await page
      .getByRole('button', { name: /^\s*(postuler|apply)\s*$/i })
      .or(page.getByRole('link', { name: /^\s*(postuler|apply)\s*$/i }))
      .first()
      .click({ timeout: 10_000 })
      .catch(() => {});
    await page.waitForTimeout(4000);

    return await applyForm(page, options);
  } catch (error) {
    return { status: 'manual', message: `Candidature WTTJ : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Les candidatures que Welcome to the Jungle déclare avoir reçues.
 *
 * Le suivi vit à `/fr/me/application-tracker`. Sans cette lecture, quatorze
 * candidatures réellement envoyées restaient invisibles : le robot ne voyait
 * pas de confirmation à l'écran et rendait « issue incertaine », alors que la
 * plateforme affichait « Candidature reçue » à côté.
 *
 * On lit les feuilles du bloc plutôt que son texte entier : la société, le
 * titre et le statut y sont concaténés sans séparateur, et les découper au
 * jugé produirait des titres tronqués à la première refonte.
 */
export async function listApplications(context, { max = 120 } = {}) {
  const page = await context.newPage();

  try {
    await page.goto('https://www.welcometothejungle.com/fr/me/application-tracker', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await dismissConsent(page);
    await page.waitForTimeout(7000);

    return await page.evaluate((limite) => {
      const ENVOI = /envoy[ée]e il y a|candidature (re[çc]ue|envoy[ée]e)/i;
      const vus = new Set();
      const sortie = [];

      for (const li of document.querySelectorAll('li')) {
        if (li.offsetParent === null) continue;
        const entier = (li.textContent || '').replace(/\s+/g, ' ').trim();
        if (!ENVOI.test(entier) || entier.length > 340) continue;

        // Les feuilles portent chacune un morceau : société, intitulé, statut.
        const morceaux = [...li.querySelectorAll('*')]
          .filter((el) => !el.querySelector('*'))
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);

        const societe = morceaux[0] || '';
        const titre = morceaux[1] || '';
        const statut = morceaux.find((m) => /candidature|entretien|refus|retenue/i.test(m)) || '';
        const cle = `${societe}|${titre}`;
        if (!titre || vus.has(cle)) continue;
        vus.add(cle);

        sortie.push({
          titre,
          societe,
          statut,
          url: li.querySelector('a[href]')?.href || '',
        });
        if (sortie.length >= limite) break;
      }
      return sortie;
    }, max);
  } finally {
    await page.close().catch(() => {});
  }
}
