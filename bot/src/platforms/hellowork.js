import { normalize, humanPause, jsonLdJobs, dismissConsent, parseRelativeDate } from './common.js';
import { applyForm } from './applyForm.js';
import { RAISONS } from './failures.js';
import { lireBlocs } from './mesCandidatures.js';

/**
 * HelloWork.
 *
 * Pas d'API publique, mais le site publie ses offres en JSON-LD pour Google :
 * on lit ce bloc en priorité, et on ne retombe sur les sélecteurs CSS que s'il
 * est absent. Les classes CSS d'un site d'emploi changent tous les trimestres,
 * son balisage schema.org presque jamais.
 */

const PER_PAGE = 20;

export const name = 'hellowork';
// La même page porte l'inscription et la connexion ; c'est le fragment
// #connexion qui sélectionne le bon onglet.
export const loginUrl =
  'https://www.hellowork.com/fr-fr/candidat/connexion-inscription.html#connexion';
export const needsSessionToSearch = false;

const CONTRACT_FILTER = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  alternance: 'Alternance',
  freelance: 'Independant',
};

function searchUrl({ keywords = [], location = '', contractTypes = [] }, pageNumber) {
  const params = new URLSearchParams();
  if (keywords.length) params.set('k', keywords.join(' '));
  if (location) params.set('l', location);
  if (pageNumber > 1) params.set('p', String(pageNumber));

  const contracts = contractTypes.map((type) => CONTRACT_FILTER[type]).filter(Boolean);
  for (const contract of new Set(contracts)) params.append('c', contract);

  return `https://www.hellowork.com/fr-fr/emploi/recherche.html?${params}`;
}

async function readCards(page) {
  return page.evaluate(() => {
    const text = (root, selectors) => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        if (node?.textContent?.trim()) return node.textContent.trim();
      }
      return '';
    };

    const cards = document.querySelectorAll('[data-cy="serpCard"], li[data-id-storage-target]');
    return [...cards]
      .map((card) => {
        const link = card.querySelector('a[href*="/emplois/"]');
        const href = link?.href || '';

        /*
         * HelloWork résume toute l'offre dans le libellé d'accessibilité du lien :
         *   « Voir offre de <titre> à <lieu>, chez <société>, pour un <contrat>, … »
         * C'est la source la plus complète de la carte, et elle ne dépend
         * d'aucune classe CSS. Les sélecteurs ne servent que de repli.
         */
        const aria = link?.getAttribute('aria-label') || '';
        const parsed = aria.match(
          /^Voir offre de\s+(.+?)\s+à\s+(.+?),\s+chez\s+(.+?),\s+pour un\s+(.+?)(?:,|$)/i
        );

        // Le titre visible vit dans le premier paragraphe du bloc ; le second
        // porte la société. Le conteneur, lui, mélange les deux.
        const paragraphs = [...card.querySelectorAll('[data-cy="offerTitle"] p, h3 p')];

        return {
          title: parsed?.[1] || paragraphs[0]?.textContent.trim() || text(card, ['h3', 'h2']),
          company: parsed?.[3] || paragraphs[1]?.textContent.trim() || '',
          location: parsed?.[2] || text(card, ['[data-cy="localisationCard"]']),
          contractHint: parsed?.[4] || text(card, ['[data-cy="contractCard"]']),
          salary: text(card, ["[data-cy=\"salaryCard\"]"]),
          publishedRaw: text(card, ["[data-cy=\"publicationCard\"]", "time"]),
          // L'URL est /fr-fr/emplois/80029410.html : pas de tiret avant l'identifiant.
          externalId: href.match(/\/emplois\/(\d+)\.html/)?.[1] || '',
          sourceUrl: href.split('?')[0],
          // L'annonce complète demanderait une requête par offre ; le libellé
          // porte déjà contrat, lieu et télétravail, de quoi filtrer utilement.
          description: aria.replace(/^Voir offre de\s+/i, ''),
        };
      })
      .filter((card) => card.title && card.sourceUrl);
  });
}

export async function search(context, query) {
  const wanted = Math.min(Math.max(1, query.limit || 25), 150);
  const page = await context.newPage();
  const collected = [];
  const seen = new Set();

  try {
    for (
      let pageNumber = 1;
      collected.length < wanted && pageNumber <= Math.ceil(wanted / PER_PAGE) + 1;
      pageNumber++
    ) {
      await page.goto(searchUrl(query, pageNumber), {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      // Attendre *les cartes*, et rien d'autre : le JSON-LD est présent dès le
      // HTML initial, donc l'attendre en alternative rend la main avant que les
      // offres ne soient rendues côté client — et la page paraît vide.
      await page
        .waitForSelector('[data-cy="serpCard"]', { timeout: 15_000 })
        .catch(() => {});

      // La page de résultats ne publie pas de JobPosting en JSON-LD (seulement
      // WebSite/Organization/BreadcrumbList) : les cartes viennent du DOM, et
      // le JSON-LD ne sert que si HelloWork se met à en publier.
      let cards = await readCards(page);
      if (!cards.length) cards = await jsonLdJobs(page);
      if (!cards.length) break;

      for (const card of cards) {
        card.publishedAt = parseRelativeDate(card.publishedRaw);
        const key = card.externalId || card.sourceUrl;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        collected.push(card);
      }
      await humanPause(900, 2000);
    }

    return collected.slice(0, wanted).map((card) => normalize(card, name));
  } finally {
    await page.close().catch(() => {});
  }
}

export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    await page.goto('https://www.hellowork.com/fr-fr/candidat/mon-espace.html', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    return !/connexion/.test(page.url());
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

    // Le rideau de consentement recouvre le formulaire : tant qu'il est là, les
    // champs existent mais restent inaccessibles.
    await dismissConsent(page);

    // La page contient *deux* formulaires : inscription (email/password) et
    // connexion (email2/password2). Cibler les champs visibles plutôt que leurs
    // noms évite de dépendre de cette numérotation, et de savoir lequel des
    // deux onglets est actif.
    const emailField = page.locator('input[type="email"]:visible').first();
    const passwordField = page.locator('input[type="password"]:visible').first();

    try {
      await emailField.waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      return {
        status: 'verification',
        message:
          "Le formulaire de connexion HelloWork n'est pas accessible (bandeau de " +
          'consentement ou page modifiée). Termine la connexion à la main.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        url: page.url(),
      };
    }

    await emailField.fill(email);
    await humanPause(300, 800);
    await passwordField.fill(password);
    await humanPause(300, 800);

    // Bouton propre au formulaire de connexion : « submit » tout court
    // attraperait aussi ceux du bandeau de cookies.
    const submit = page.getByRole('button', { name: /je me connecte|connexion/i }).first();
    if (await submit.count()) await submit.click();
    else await passwordField.press('Enter');

    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});

    if (/connexion-inscription/.test(page.url())) {
      return {
        status: 'verification',
        message:
          "HelloWork n'a pas validé la connexion : vérifie les identifiants, ou " +
          'termine la vérification à la main.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        url: page.url(),
      };
    }
    return { status: 'connected', message: 'Session HelloWork ouverte.', url: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
/**
 * Candidature HelloWork.
 *
 * Le formulaire vit **dans la page de l’annonce** (ancre `#postuler`), pas sur
 * une page à part : le clic fait défiler, il ne navigue pas. Tout le reste est
 * du remplissage de formulaire ordinaire, délégué à `applyForm` — dont les
 * règles ont précisément été tirées de ce site : champ fichier vidé après
 * téléversement, bouton d’envoi hors du `<form>`, parcours en plusieurs écrans.
 */
export async function apply(context, offer, options = {}) {
  const page = await context.newPage();
  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'domcontentloaded' });
    await dismissConsent(page);
    await humanPause();

    /*
     * Beaucoup d'annonces HelloWork ne se candidatent pas sur HelloWork : le
     * bouton s'y intitule « Postuler sur le site du recruteur » et mène à l'ATS
     * de l'employeur. Le repérer d'abord évite un diagnostic trompeur — le
     * remplisseur y trouvait un formulaire de page (recherche, alerte) et
     * concluait « aucun champ pour joindre le CV », ce qui laissait croire à un
     * défaut du robot alors que l'annonce n'était simplement pas candidatable
     * ici.
     */
    const externe = page
      .getByRole('link', { name: /sur le site (du|de l)/i })
      .or(page.getByRole('button', { name: /sur le site (du|de l)/i }))
      .first();
    if (await externe.count()) {
      // Le lien n'est parfois qu'une ancre (« #postuler ») : la vraie
      // redirection se fait au clic. L'afficher n'apprendrait rien.
      const cible = await externe.getAttribute('href').catch(() => null);
      const externeUtile = cible && /^https?:\/\//.test(cible) ? cible : null;
      /*
       * Une candidature qui se fait ailleurs n'est pas un envoi raté.
       *
       * Ce cas rendait « manual », donc un échec d'envoi indifférencié : la
       * campagne redépensait son quota sur la même annonce à chaque passage, et
       * la statistique comptait un échec là où il n'y avait rien à envoyer. Les
       * autres plateformes le disent déjà avec `external` ; HelloWork était le
       * dernier à ne pas le faire.
       */
      return {
        status: 'external',
        reason: RAISONS.REDIRECTION_EXTERNE,
        message: `L'employeur reçoit les candidatures sur son propre site${
          externeUtile ? ` : ${externeUtile}` : ''
        } — rien à remplir sur HelloWork.`,
        ...(externeUtile ? { externalUrl: externeUtile } : {}),
      };
    }

    // Le libellé varie (« Postuler », « Je postule »…) : on cible le rôle et le
    // verbe plutôt qu’une classe, qui change à chaque refonte.
    const bouton = page
      .getByRole('link', { name: /postuler|je postule/i })
      .or(page.getByRole('button', { name: /postuler|je postule/i }))
      .first();

    if (!(await bouton.count())) {
      return {
        status: 'manual',
        message: "Aucun bouton « Postuler » sur cette offre (candidature externe).",
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    await bouton.click().catch(() => {});
    await humanPause(1200, 2000);

    return await applyForm(page, options);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Ce que HelloWork dit avoir reçu.
 *
 * Ses cartes sont des `article` dont les premières lignes sont, dans l'ordre :
 * le statut (« Envoyée »), l'intitulé, puis la société. La pagination se fait
 * par `?p=N`, dix par page.
 *
 * On s'arrête dès qu'une page ne rapporte plus rien de neuf : la liste peut
 * compter des centaines d'entrées, et les parcourir toutes pour rapprocher une
 * poignée de candidatures serait du temps perdu.
 */
export async function listApplications(context, { max = 120 } = {}) {
  const page = await context.newPage();
  const candidatures = [];

  try {
    for (let numero = 1; candidatures.length < max && numero <= 20; numero += 1) {
      const url =
        'https://www.hellowork.com/fr-fr/candidat/mes-candidatures.html' +
        (numero > 1 ? `?p=${numero}` : '');

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (numero === 1) await dismissConsent(page);
      await page.waitForTimeout(2200);

      const blocs = await lireBlocs(page, 'article', { lignesMini: 3 });
      if (!blocs.length) break;

      for (const bloc of blocs) {
        const [statut, titre, societe] = bloc.lignes;
        if (!titre) continue;
        candidatures.push({
          titre,
          societe: societe || '',
          statut: statut || '',
          url: bloc.lien || '',
        });
      }

      await humanPause(600, 1200);
    }

    return candidatures.slice(0, max);
  } finally {
    await page.close().catch(() => {});
  }
}
