import { normalize, cleanHtml, humanPause, dismissConsent, parseRelativeDate, sessionOuverte } from './common.js';
import { applyForm } from './applyForm.js';
import { lireBlocs, deroulerListe } from './mesCandidatures.js';

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

/*
 * `easyApplyOnly` est vrai par défaut, et c'est un choix de fond.
 *
 * L'option existait déjà mais personne ne la passait : elle valait donc
 * toujours `false`. La collecte ramenait en majorité des annonces dont la
 * candidature se fait sur le site de l'employeur — la campagne les préparait,
 * puis butait sur l'absence de formulaire. Autant ne collecter que ce sur quoi
 * on sait réellement postuler ; un appelant qui veut parcourir large peut
 * toujours demander l'inverse.
 */
function searchUrl({ keywords = [], location = '', contractTypes = [], remotes = [], easyApplyOnly = true }, start) {
  const params = new URLSearchParams({ start: String(start) });
  if (keywords.length) params.set('keywords', keywords.join(' '));
  if (location) params.set('location', location);

  const jobTypes = contractTypes.map((type) => CONTRACT_FILTER[type]).filter(Boolean);
  if (jobTypes.length) params.set('f_JT', [...new Set(jobTypes)].join(','));

  const workplace = remotes.map((mode) => REMOTE_FILTER[mode]).filter(Boolean);
  if (workplace.length) params.set('f_WT', workplace.join(','));

  /*
   * « Candidature simplifiée » seulement.
   *
   * Sans ce filtre, la recherche ramène surtout des annonces dont la
   * candidature se fait sur le site de l'employeur : la campagne les prépare
   * puis échoue à les envoyer, faute de formulaire à remplir. Vérifié à
   * l'essai : 0 offre envoyable sur 4 sans le filtre, 3 sur 4 avec.
   */
  if (easyApplyOnly) params.set('f_AL', 'true');

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
          sourceUrl: href.split("?")[0],
          externalId: id,
          // LinkedIn date ses cartes en absolu (datetime) ou en relatif.
          publishedRaw:
            card.querySelector("time")?.getAttribute("datetime") ||
            card.querySelector("time, .job-search-card__listdate, .job-search-card__listdate--new")?.textContent?.trim() ||
            "",
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
      // « 27 candidats » / « Plus de 100 candidatures » : le chiffre qui dit
      // si l on arrive tôt ou dans la foule.
      const texte = document.body.innerText || "";
      // Les espaces insécables des milliers deviennent des espaces ordinaires.
      const candidats = /(\d[\d\s]{0,6})\s*(candidat|applicant)/i.exec(
        texte.replace(/ /g, ' ')
      );
      return {
        description: block?.innerHTML || "",
        contractHint: criteria.join(" · "),
        applicantCount: candidats ? Number(candidats[1].replace(/\s/g, '')) : null,
      };
    });
  } catch {
    return { description: '', contractHint: '' };
  }
}

/** Date ISO fournie telle quelle, sinon ancienneté relative à décoder. */
function absOrRelative(brut) {
  if (!brut) return undefined;
  const iso = new Date(brut);
  return Number.isNaN(iso.getTime()) ? parseRelativeDate(brut) : iso;
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

    return kept.map((card) =>
      normalize({ ...card, publishedAt: absOrRelative(card.publishedRaw) }, name)
    );
  } finally {
    await page.close().catch(() => {});
  }
}

export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    return await sessionOuverte(
      page,
      'https://www.linkedin.com/feed/',
      /\/(login|uas\/login|checkpoint)/
    );
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
/**
 * Candidature LinkedIn (« Candidature simplifiée »).
 *
 * Deux pièges, tous deux constatés à l'essai :
 *
 * 1. `offer.sourceUrl` vient de la recherche **invité** (`fr.linkedin.com`) et
 *    rend la page publique — celle qui propose de s'inscrire — même avec une
 *    session valide. Il faut reconstruire l'URL authentifiée à partir de
 *    l'identifiant, sans quoi on ne voit jamais le bouton de candidature.
 *
 * 2. Les classes CSS de LinkedIn sont générées (`_29eb6fa7 _9b65a86c…`) et
 *    changent à chaque déploiement. L'ancien `button.jobs-apply-button` ne
 *    correspondait plus à rien. On cible le libellé, qui lui est stable.
 *
 * Beaucoup d'annonces n'ont pas de candidature simplifiée du tout : elles
 * n'offrent qu'« Enregistrer » ou « Je suis intéressé(e) ». On le dit.
 */
export async function apply(context, offer, options = {}) {
  const page = await context.newPage();
  try {
    // L'identifiant numérique est la seule partie fiable : le slug change.
    const id = offer.externalId || offer.sourceUrl?.match(/-(\d+)(?:\?|$)/)?.[1];
    if (!id) {
      return { status: 'manual', message: "Offre LinkedIn sans identifiant exploitable." };
    }

    await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    // LinkedIn rend le bloc d'action en dernier : un délai fixe le rate une
    // fois sur deux, d'où l'attente sur le bouton lui-même.
    const easyApply = page.getByRole('button', { name: /candidature simplifiée|easy apply/i }).first();
    await easyApply.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});

    if (!(await easyApply.count())) {
      // Distinguer « pas de candidature simplifiée » de « session fermée » :
      // les deux donnent une page sans bouton, mais ne se règlent pas pareil.
      const invite = await page.locator('.sign-up-modal__outlet').count();
      return {
        status: 'manual',
        message: invite
          ? 'LinkedIn affiche la page publique : la session est fermée ou expirée.'
          : "Cette offre n'a pas de candidature simplifiée (candidature sur le site de l'employeur).",
      };
    }

    await easyApply.click().catch(() => {});

    /*
     * La candidature simplifiée s'ouvre dans une boîte de dialogue.
     *
     * Elle est bâtie sur la balise `<dialog>`, **sans** attribut `role` — ses
     * classes sont par ailleurs des empreintes illisibles, régénérées à chaque
     * déploiement. Ne chercher que `[role="dialog"]` ne trouvait donc jamais
     * rien, et le robot concluait à tort que LinkedIn refusait d'ouvrir son
     * module dans un navigateur piloté. Il l'ouvre parfaitement : c'était le
     * sélecteur qui regardait à côté.
     */
    const modale = page
      .locator('dialog, [role="dialog"], [data-testid*="modal"]')
      .filter({ has: page.locator('input, textarea, select') });
    await modale.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});

    if (!(await modale.count())) {
      return {
        status: 'manual',
        message:
          "LinkedIn n'a pas ouvert sa candidature simplifiée (page modifiée, ou " +
          'vérification de sécurité). Reprends la main depuis l’onglet Comptes.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    await humanPause(1500, 2500);

    /*
     * Le reste est un formulaire ordinaire, confié au remplisseur commun. Seuls
     * les libellés d'action lui sont propres : LinkedIn enchaîne « Suivant »,
     * « Vérifier » puis « Envoyer la candidature » plutôt qu'un bouton unique.
     */
    return await applyForm(page, {
      ...options,
      submitSelector:
        'button[aria-label*="Envoyer la candidature" i], button[aria-label*="Submit application" i], ' +
        'button[aria-label*="Suivant" i], button[aria-label*="Continue" i], ' +
        'button[aria-label*="Vérifier" i], button[aria-label*="Review" i]',
      /*
       * Les libellés visibles, parce que les attributs ne suffisent pas : le
       * « Suivant » de LinkedIn n'a pas d'`aria-label` et n'est pas de type
       * `submit`. Le motif est volontairement ancré — un « name » partiel
       * attraperait aussi « Ignorer » ou le bouton de fermeture.
       */
      submitText:
        /^(suivant|next|continuer|continue|v[ée]rifier|review|envoyer la candidature|submit application|soumettre)$/i,
      // Écrans intermédiaires que l'essai a le droit de franchir pour aller
      // vérifier que le CV se joint bien. Aucun libellé d'envoi ici.
      advanceText: /^(suivant|next|continuer|continue|v[ée]rifier|review)$/i,
      confirmPattern:
        /candidature (bien )?(envoy|transmis)|votre candidature a été envoyée|application sent|candidature envoyée/i,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Ce que LinkedIn dit avoir reçu.
 *
 * Son suivi range les candidatures derrière un onglet — « Candidature · 424 » —
 * et ouvre par défaut sur « Enregistré », qui est vide. Sans ce clic, la page
 * paraît ne rien contenir alors qu'elle porte des centaines d'entrées.
 */
export async function listApplications(context, { max = 120 } = {}) {
  const page = await context.newPage();

  try {
    await page.goto('https://www.linkedin.com/jobs-tracker/', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(4000);

    /*
     * L'onglet est un bouton *radio* — `div[role="radio"]` contenant un
     * `label` — et non un onglet ni un bouton. Le chercher par le rôle
     * « bouton » ou « tab » ne trouvait rien, et la page restait sur
     * « Enregistré », qui est vide : on en concluait zéro candidature là où il y
     * en a des centaines.
     */
    const onglet = page
      .locator('[role="radio"], label')
      .filter({ hasText: /^\s*Candidature\s*·/i })
      .first();
    if (await onglet.isVisible().catch(() => false)) {
      await onglet.click().catch(() => {});
      await page.waitForTimeout(5000);
    }

    await deroulerListe(page, { tours: Math.ceil(max / 20) + 2 });

    /*
     * Chaque ligne du suivi est un lien vers l'offre, et ce lien porte son
     * identifiant : le rapprochement se fait donc à l'exact, sans dépendre du
     * libellé. C'est précieux ici, car le texte de la ligne colle l'intitulé et
     * la société sans séparateur — « Développeur H/F SP SEARCH · Guyancourt » —
     * et rien ne dirait où l'un finit et où l'autre commence.
     */
    return page.evaluate((limite) => {
      const vus = new Set();
      const sorties = [];

      for (const lien of document.querySelectorAll('a[href*="/jobs/view/"]')) {
        const href = lien.getAttribute('href') || '';
        const id = href.match(/\/jobs\/view\/(\d+)/)?.[1];
        if (!id || vus.has(id)) continue;

        const texte = (lien.textContent || '').replace(/\s+/g, ' ').trim();
        if (!/Candidature d[ée]pos[ée]e/i.test(texte)) continue;

        vus.add(id);
        sorties.push({
          externalId: id,
          titre: texte.split(/Candidature d[ée]pos[ée]e/i)[0].trim().slice(0, 120),
          societe: '',
          statut: 'Candidature',
          url: `https://www.linkedin.com/jobs/view/${id}/`,
        });
        if (sorties.length >= limite) break;
      }

      return sorties;
    }, max);
  } finally {
    await page.close().catch(() => {});
  }
}
