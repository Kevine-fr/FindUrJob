import { normalize, humanPause } from './common.js';

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
          contractHint: hit.contract_type || '',
          remote: /full|fulltime|total/i.test(hit.remote || '') ? 'teletravail' : undefined,
        },
        name
      );
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// Pas de candidature automatisée : chaque annonce a son propre parcours.
export async function isLoggedIn() {
  return false;
}

export async function login() {
  return {
    status: 'manual',
    message: "La candidature Welcome to the Jungle n'est pas automatisée.",
  };
}

export async function apply() {
  return {
    status: 'manual',
    message: 'Welcome to the Jungle : candidature à faire depuis l’annonce.',
  };
}
