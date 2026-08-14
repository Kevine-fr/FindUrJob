import { normalize, humanPause, jsonLdJobs, dismissConsent, parseRelativeDate } from './common.js';

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
 * Candidature HelloWork.
 *
 * Le formulaire vit **dans la page de l'annonce** (ancre `#postuler`), pas sur
 * une page à part. Il exige nom, prénom, e-mail et l'acceptation des CGU en
 * plus du CV : n'envoyer que le fichier ne suffit pas, le formulaire reste en
 * erreur sans le dire.
 *
 * Champs relevés sur le site :
 *   Firstname · LastName · Email · MotivationLetter · upload · HasAcceptedCGU
 */
export async function apply(context, offer, { cvFile, applicant = {}, coverLetter, dryRun } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'domcontentloaded' });
    await dismissConsent(page);
    await humanPause();

    // Le libellé varie (« Postuler », « Je postule », « Postuler à cette offre ») :
    // on cible le rôle et le verbe plutôt qu'une classe.
    const button = page
      .getByRole('link', { name: /postuler|je postule/i })
      .or(page.getByRole('button', { name: /postuler|je postule/i }))
      .first();

    if (!(await button.count())) {
      return {
        status: 'manual',
        message: "Aucun bouton « Postuler » sur cette offre (candidature externe).",
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    // « Postuler » est une ancre `#postuler` dans la même page : le clic fait
    // défiler jusqu'au formulaire, il ne navigue pas.
    await button.click().catch(() => {});
    await humanPause(1200, 2000);

    const formulaire = page.locator('form').filter({ has: page.locator('input[type="file"]') }).first();
    if (!(await formulaire.count())) {
      return {
        status: 'manual',
        message: "Le formulaire de candidature ne s'est pas affiché.",
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    // Remplissage. Chaque champ est facultatif à l'écriture (le site peut les
    // pré-remplir depuis la session) mais obligatoire à l'envoi : on n'écrase
    // que ce qui est vide, sinon on remplacerait les données du compte.
    const remplir = async (selecteur, valeur) => {
      if (!valeur) return;
      const champ = formulaire.locator(selecteur).first();
      if (!(await champ.count())) return;
      if (!(await champ.inputValue().catch(() => ''))) {
        await champ.fill(String(valeur)).catch(() => {});
        await humanPause(200, 500);
      }
    };

    await remplir('input[name="Firstname"]', applicant.firstName);
    await remplir('input[name="LastName"]', applicant.lastName);
    await remplir('input[name="Email"]', applicant.email);
    await remplir('textarea[name="MotivationLetter"]', coverLetter);

    // Le CV. Sans pièce jointe, on n'envoie pas : une candidature vide dessert.
    //
    // HelloWork téléverse le fichier en arrière-plan puis **vide** le champ et
    // range une référence dans le champ caché `JweHashResume`. C'est donc ce
    // jeton, et non la valeur du champ fichier, qui atteste que le CV est passé.
    let cvJoint = false;
    if (cvFile) {
      const upload = formulaire.locator('input[type="file"]').first();
      if (await upload.count()) {
        await upload.setInputFiles(cvFile).catch(() => {});
        cvJoint = await formulaire
          .locator('input[name="JweHashResume"]')
          .first()
          .waitFor({ state: 'attached', timeout: 1000 })
          .then(() =>
            page.waitForFunction(
              () =>
                Boolean(
                  document.querySelector('input[name="JweHashResume"]')?.value
                ),
              undefined,
              { timeout: 30_000 }
            )
          )
          .then(() => true)
          // Pas de champ caché sur ce formulaire : le champ fichier suffit.
          .catch(() => Boolean(cvFile));
      }
    }
    if (cvFile && !cvJoint) {
      return {
        status: 'manual',
        message: "CV non accepté par la plateforme : envoi interrompu.",
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    // Les cases à cocher obligatoires — CGU en tête. Sans elles, le formulaire
    // refuse silencieusement : c'est ce qui bloquait tous les envois.
    for (const nom of ['HasAcceptedCGU', 'CriterionChecked']) {
      const case_ = formulaire.locator(`input[type="checkbox"][name="${nom}"]`).first();
      if ((await case_.count()) && !(await case_.isChecked().catch(() => true))) {
        await case_.check({ force: true }).catch(() => {});
      }
    }

    // Dernier contrôle avant envoi. Les champs `file` sont exclus : la
    // plateforme les vide après téléversement, ils paraîtraient toujours
    // manquants alors que le CV est bien arrivé (cf. `JweHashResume` plus haut).
    const manquants = await formulaire.evaluate((form) =>
      [...form.querySelectorAll('input[required], textarea[required], select[required]')]
        .filter((el) =>
          el.type === 'checkbox' ? !el.checked : el.type !== 'file' && !el.value
        )
        .map((el) => el.name || el.id)
        .slice(0, 6)
    );

    if (manquants.length) {
      return {
        status: 'manual',
        message: `Champs obligatoires non renseignés : ${manquants.join(', ')}.`,
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    // Le bouton d'envoi est **hors du `<form>`** : HelloWork le pose dans le
    // conteneur du parcours. Le chercher dans le formulaire ne donne rien.
    const submit = page.locator('[data-cy="submitButton"], button[type="submit"]').last();
    if (!(await submit.count())) {
      return {
        status: 'manual',
        message: "Bouton d'envoi introuvable sur la page.",
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    // Mode essai : tout est prêt, on ne soumet pas. Sert à vérifier le parcours
    // sans envoyer une vraie candidature à un employeur.
    if (dryRun) {
      return {
        status: 'dry-run',
        message: `Prêt à envoyer — non soumis (mode essai). Bouton : « ${(
          await submit.innerText().catch(() => '?')
        ).trim()} ».`,
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    // « Continuer ma candidature » : le parcours peut compter plusieurs écrans
    // (questions de l'employeur, récapitulatif). On avance tant qu'un bouton
    // d'envoi reste cliquable, en s'arrêtant dès la confirmation.
    const confirme = /candidature (bien )?(envoy|transmis|enregistr)|merci pour votre candidature|votre candidature a bien/;
    let texte = '';

    for (let etape = 0; etape < 4; etape += 1) {
      const bouton = page.locator('[data-cy="submitButton"], button[type="submit"]').last();
      if (!(await bouton.isVisible().catch(() => false))) break;

      await bouton.click().catch(() => {});
      await humanPause(2500, 4000);

      texte = (await page.innerText('body').catch(() => '')).toLowerCase();
      if (confirme.test(texte)) {
        return { status: 'sent', message: 'Candidature envoyée, CV joint.' };
      }

      // Un écran intermédiaire peut poser ses propres questions obligatoires :
      // on ne sait pas y répondre, on rend la main plutôt que de deviner.
      const bloquants = await page
        .locator('form')
        .first()
        .evaluate((form) =>
          [...form.querySelectorAll('input[required], textarea[required], select[required]')]
            .filter((el) =>
              el.type === 'checkbox' ? !el.checked : el.type !== 'file' && !el.value
            )
            .map((el) => el.name || el.id)
            .slice(0, 6)
        )
        .catch(() => []);

      if (bloquants.length) {
        return {
          status: 'manual',
          message: `Étape ${etape + 2} : question(s) de l'employeur à remplir à la main (${bloquants.join(', ')}).`,
          screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        };
      }
    }

    if (confirme.test(texte)) {
      return { status: 'sent', message: 'Candidature envoyée, CV joint.' };
    }

    return {
      status: 'manual',
      message: 'Formulaire soumis sans confirmation visible : à vérifier sur la plateforme.',
      screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
    };
  } finally {
    await page.close().catch(() => {});
  }
}
