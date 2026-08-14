/**
 * Remplissage générique d'un formulaire de candidature.
 *
 * Écrit après avoir sondé HelloWork : les plateformes se ressemblent bien plus
 * que leurs sélecteurs ne le laissent croire. Toutes demandent un nom, un
 * e-mail, un CV et une case à cocher, mais aucune ne nomme ses champs pareil.
 * Plutôt que de deviner un sélecteur par site — ce qui casse à la première
 * refonte — on reconnaît les champs à leur **rôle** : attribut `name`, `id`,
 * `autocomplete`, `placeholder`, `aria-label` et libellé associé.
 *
 * Trois leçons de HelloWork sont câblées ici, parce qu'elles ne sont pas
 * propres à HelloWork :
 *   1. le champ fichier peut être vidé après téléversement (transfert AJAX,
 *      référence rangée dans un champ caché) — il ne prouve donc rien ;
 *   2. le bouton d'envoi vit souvent **hors** du `<form>` ;
 *   3. le parcours compte plusieurs écrans avant la confirmation.
 */

import { humanPause } from './common.js';

/** Ce qu'on sait reconnaître, du plus spécifique au plus général. */
const ROLES = {
  firstName: /pr[ée]nom|first.?name|given.?name|^fname/i,
  lastName: /^nom$|nom.?de.?famille|last.?name|surname|family.?name|^lname/i,
  email: /e.?mail|courriel/i,
  phone: /t[ée]l[ée]?phone|^tel$|phone|mobile|portable/i,
};

/** Cases à cocher qu'on accepte : conditions, consentement, RGPD. */
const CONSENT = /cgu|cgv|condition|consent|accept|rgpd|privacy|charte|politique/i;

/** Cases qu'on ne coche jamais : ce serait s'inscrire à autre chose. */
const REFUSE = /newsletter|alerte|publicit|marketing|commercial|partenaire|offres? d/i;

/**
 * Le formulaire de candidature de la page, s'il y en a un.
 * Priorité au formulaire portant un champ fichier ; à défaut, celui qui porte
 * un champ e-mail — certaines plateformes reprennent le CV du profil.
 */
async function trouverFormulaire(page) {
  const avecFichier = page.locator('form').filter({ has: page.locator('input[type="file"]') });
  if (await avecFichier.count()) return avecFichier.first();

  const avecEmail = page.locator('form').filter({ has: page.locator('input[type="email"]') });
  if (await avecEmail.count()) return avecEmail.first();

  return null;
}

/**
 * Remplit les champs qu'on sait identifier.
 * On n'écrase jamais une valeur existante : quand la plateforme connaît déjà la
 * personne, ses données valent mieux que les nôtres.
 */
async function remplirChamps(formulaire, valeurs) {
  return formulaire.evaluate(
    (form, { valeurs, roles }) => {
      const motifs = Object.fromEntries(
        Object.entries(roles).map(([cle, source]) => [cle, new RegExp(source, 'i')])
      );

      // Tout ce qui peut nommer un champ, libellé compris.
      const signature = (el) => {
        const libelle = el.labels?.[0]?.textContent || '';
        return [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label'), libelle]
          .filter(Boolean)
          .join(' ');
      };

      const remplis = [];
      const champs = [...form.querySelectorAll('input, textarea')];

      for (const el of champs) {
        if (el.disabled || el.readOnly || el.type === 'hidden' || el.value) continue;

        let role = null;
        if (el.type === 'email') role = 'email';
        else if (el.type === 'tel') role = 'phone';
        else if (el.tagName === 'TEXTAREA') role = 'coverLetter';
        else if (el.type === 'text' || el.type === '') {
          role = Object.keys(motifs).find((cle) => motifs[cle].test(signature(el))) || null;
        }

        const valeur = role && valeurs[role];
        if (!valeur) continue;

        // Passer par le setter natif : React n'entend pas une écriture directe
        // de `.value`, et remettrait son propre état au premier rendu.
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, valeur);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        remplis.push(role);
      }

      return remplis;
    },
    { valeurs, roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.source])) }
  );
}

/**
 * Coche ce qui est obligatoire ou relève du consentement, jamais la publicité.
 * Une case marketing cochée à la place de la personne n'est pas un détail.
 */
async function cocherCases(formulaire) {
  const cases = formulaire.locator('input[type="checkbox"]');
  const total = await cases.count();

  for (let i = 0; i < total; i += 1) {
    const item = cases.nth(i);
    const signature = await item
      .evaluate((el) =>
        [el.name, el.id, el.labels?.[0]?.textContent, el.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ')
      )
      .catch(() => '');

    const obligatoire = await item.evaluate((el) => el.required).catch(() => false);
    if (REFUSE.test(signature)) continue;
    if (!obligatoire && !CONSENT.test(signature)) continue;
    if (await item.isChecked().catch(() => true)) continue;

    await item.check({ force: true }).catch(() => {});
  }
}

/** Les champs obligatoires encore vides — hors champs fichier (cf. plus bas). */
const manquants = (formulaire) =>
  formulaire
    .evaluate((form) =>
      [...form.querySelectorAll('input[required], textarea[required], select[required]')]
        .filter((el) => (el.type === 'checkbox' ? !el.checked : el.type !== 'file' && !el.value))
        .map((el) => el.name || el.id || el.type)
        .slice(0, 6)
    )
    .catch(() => []);

/**
 * Candidate sur le formulaire de la page courante.
 *
 * @param page          Onglet déjà positionné sur l'annonce, formulaire ouvert.
 * @param cvFile        { name, mimeType, buffer } — le PDF à joindre.
 * @param applicant     { firstName, lastName, email, phone }
 * @param coverLetter   Lettre de motivation.
 * @param dryRun        Remplir jusqu'au bouton d'envoi, sans appuyer.
 * @param submitSelector Sélecteurs d'envoi, du plus sûr au plus large.
 * @param confirmPattern Ce que la page doit dire pour qu'on parle d'envoi.
 */
export async function applyForm(
  page,
  {
    cvFile,
    applicant = {},
    coverLetter,
    dryRun = false,
    submitSelector = '[data-cy="submitButton"], button[type="submit"], input[type="submit"]',
    confirmPattern = /candidature (bien )?(envoy|transmis|enregistr|re[çc]u)|merci pour votre candidature|votre candidature a bien|application (sent|submitted|received)/i,
  } = {}
) {
  const capture = async () => (await page.screenshot({ type: 'png' })).toString('base64');

  const formulaire = await trouverFormulaire(page);
  if (!formulaire) {
    return {
      status: 'manual',
      message: "Aucun formulaire de candidature sur la page : à faire depuis l'annonce.",
      screenshot: await capture(),
    };
  }

  await remplirChamps(formulaire, {
    firstName: applicant.firstName || '',
    lastName: applicant.lastName || '',
    email: applicant.email || '',
    phone: applicant.phone || '',
    coverLetter: coverLetter || '',
  });
  await humanPause(400, 900);

  // Le CV. Sans pièce jointe, on n'envoie pas : une candidature vide dessert.
  if (cvFile) {
    const upload = formulaire.locator('input[type="file"]').first();
    if (!(await upload.count())) {
      return {
        status: 'manual',
        message: 'Champ de fichier absent : CV non joint, envoi interrompu.',
        screenshot: await capture(),
      };
    }

    await upload.setInputFiles(cvFile).catch(() => {});

    // Le champ fichier ne prouve rien : la plateforme peut le vider après un
    // transfert en arrière-plan. On attend soit sa valeur, soit la trace du
    // téléversement (champ caché renseigné, nom du fichier affiché).
    //
    // La surveillance porte sur **ce** formulaire, pas sur « le premier de la
    // page qui a un champ fichier » : une page qui en contient plusieurs (dépôt
    // de CV dans l'en-tête, formulaire caché) ferait alors surveiller le mauvais
    // et conclure à tort que le CV a été refusé.
    const accepte = await formulaire
      .elementHandle()
      .then((handle) =>
        page.waitForFunction(
          ([form, nom]) => {
            if (!form) return false;
            if (form.querySelector('input[type="file"]')?.value) return true;
            const caches = [...form.querySelectorAll('input[type="hidden"]')];
            if (caches.some((el) => /resume|cv|file|upload|attach/i.test(el.name) && el.value)) {
              return true;
            }
            return form.textContent.includes(nom);
          },
          [handle, cvFile.name],
          { timeout: 30_000 }
        )
      )
      .then(() => true)
      .catch(() => false);

    if (!accepte) {
      return {
        status: 'manual',
        message: 'CV non accepté par la plateforme : envoi interrompu.',
        screenshot: await capture(),
      };
    }
  }

  await cocherCases(formulaire);
  await humanPause(400, 900);

  const vides = await manquants(formulaire);
  if (vides.length) {
    return {
      status: 'manual',
      message: `Champs obligatoires non renseignés : ${vides.join(', ')}.`,
      screenshot: await capture(),
    };
  }

  // Le bouton d'envoi est cherché sur la page, pas dans le formulaire : les
  // parcours en plusieurs écrans le posent dans le conteneur du funnel.
  const bouton = () => page.locator(submitSelector).last();
  if (!(await bouton().isVisible().catch(() => false))) {
    return {
      status: 'manual',
      message: "Bouton d'envoi introuvable sur la page.",
      screenshot: await capture(),
    };
  }

  if (dryRun) {
    return {
      status: 'dry-run',
      message: `Prêt à envoyer — non soumis (mode essai). Bouton : « ${(
        await bouton().innerText().catch(() => '?')
      ).trim()} ».`,
      screenshot: await capture(),
    };
  }

  // Plusieurs écrans possibles : on avance tant qu'un bouton d'envoi répond,
  // et on s'arrête net à la confirmation.
  let texte = '';
  for (let etape = 0; etape < 4; etape += 1) {
    if (!(await bouton().isVisible().catch(() => false))) break;

    await bouton().click().catch(() => {});
    await humanPause(2500, 4000);

    texte = await page.innerText('body').catch(() => '');
    if (confirmPattern.test(texte)) {
      return { status: 'sent', message: 'Candidature envoyée, CV joint.' };
    }

    // Un écran intermédiaire peut poser ses propres questions obligatoires :
    // on ne sait pas y répondre, on rend la main plutôt que de deviner.
    const suivant = await trouverFormulaire(page);
    const bloquants = suivant ? await manquants(suivant) : [];
    if (bloquants.length) {
      return {
        status: 'manual',
        message: `Étape ${etape + 2} : question(s) de l'employeur à remplir à la main (${bloquants.join(', ')}).`,
        screenshot: await capture(),
      };
    }
  }

  return {
    status: 'manual',
    message: 'Formulaire soumis sans confirmation visible : à vérifier sur la plateforme.',
    screenshot: await capture(),
  };
}

/**
 * L'annonce renvoie-t-elle vers l'ATS d'un employeur ?
 *
 * Welcome to the Jungle en est l'exemple type : « Postuler » pointe souvent
 * vers `contactrh`, Greenhouse, Lever ou Workday. On ne suit pas ces liens —
 * chaque ATS a son parcours, et candidater à l'aveugle sur un site tiers est le
 * meilleur moyen d'envoyer n'importe quoi.
 */
export async function externalApplyUrl(page, hote) {
  return page
    .evaluate((interne) => {
      const lien = [...document.querySelectorAll('a[href]')]
        .filter((el) => /postuler|candidater|apply/i.test((el.textContent || '').trim()))
        .map((el) => el.href)
        .find((href) => {
          try {
            return !new URL(href).hostname.endsWith(interne);
          } catch {
            return false;
          }
        });
      return lien || null;
    }, hote)
    .catch(() => null);
}
