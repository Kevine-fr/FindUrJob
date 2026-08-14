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

  /*
   * Repli sur la fenêtre modale.
   *
   * Tous les sites ne construisent pas leur candidature autour d'un `<form>` :
   * LinkedIn ouvre une boîte de dialogue faite de `div`, sans balise de
   * formulaire. Exiger un `<form>` y renvoyait « aucun formulaire » alors que
   * les champs étaient bien là, à l'écran. Le conteneur de dialogue joue le
   * même rôle : c'est la portée du remplissage.
   */
  const dialogue = page
    .locator('[role="dialog"], dialog')
    .filter({ has: page.locator('input, textarea') });
  if (await dialogue.count()) return dialogue.last();

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

  /**
   * Un écran du parcours : remplir ce qu'on sait, joindre le CV si son champ
   * est là, cocher les consentements.
   *
   * Le CV n'est pas exigé à chaque écran, et c'est la leçon de LinkedIn : sa
   * candidature simplifiée commence par les coordonnées et ne propose le CV
   * qu'à l'étape suivante. Exiger le champ dès le premier écran faisait
   * abandonner un parcours parfaitement valide.
   */
  async function traiterEcran(scope) {
    await remplirChamps(scope, {
      firstName: applicant.firstName || '',
      lastName: applicant.lastName || '',
      email: applicant.email || '',
      phone: applicant.phone || '',
      coverLetter: coverLetter || '',
    });
    await humanPause(400, 900);

    let joint = false;
    const upload = scope.locator('input[type="file"]').first();
    if (cvFile && (await upload.count())) {
      await upload.setInputFiles(cvFile).catch(() => {});

      // Le champ fichier ne prouve rien : la plateforme peut le vider après un
      // transfert en arrière-plan et ranger une référence ailleurs. On surveille
      // **ce** conteneur — pas « le premier de la page », qui pourrait être un
      // autre formulaire et ferait conclure à tort à un refus.
      joint = await scope
        .elementHandle()
        .then((handle) =>
          page.waitForFunction(
            ([racine, nom]) => {
              if (!racine) return false;
              if (racine.querySelector('input[type="file"]')?.value) return true;
              const caches = [...racine.querySelectorAll('input[type="hidden"]')];
              if (caches.some((el) => /resume|cv|file|upload|attach/i.test(el.name) && el.value)) {
                return true;
              }
              return racine.textContent.includes(nom);
            },
            [handle, cvFile.name],
            { timeout: 30_000 }
          )
        )
        .then(() => true)
        .catch(() => false);

      if (!joint) {
        return { erreur: 'CV non accepté par la plateforme : envoi interrompu.' };
      }
    }

    await cocherCases(scope);
    await humanPause(400, 900);

    const vides = await manquants(scope);
    if (vides.length) {
      return { erreur: `Champs obligatoires non renseignés : ${vides.join(', ')}.` };
    }

    return { joint };
  }

  const premier = await trouverFormulaire(page);
  if (!premier) {
    return {
      status: 'manual',
      message: "Aucun formulaire de candidature sur la page : à faire depuis l'annonce.",
      screenshot: await capture(),
    };
  }

  const etat = await traiterEcran(premier);
  if (etat.erreur) {
    return { status: 'manual', message: etat.erreur, screenshot: await capture() };
  }
  let cvJoint = etat.joint;

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
    // Le CV est le point qui décide de la valeur d'une candidature : le dire
    // explicitement évite de croire un essai concluant alors qu'il partirait nu.
    const libelle = (await bouton().innerText().catch(() => '?')).trim();
    return {
      status: cvFile && !cvJoint ? 'manual' : 'dry-run',
      message:
        cvFile && !cvJoint
          ? `Formulaire prêt, mais aucun champ pour joindre le CV sur cet écran (bouton « ${libelle} »). Le CV se joint peut-être à l'étape suivante : à vérifier avant d'activer l'envoi.`
          : `Prêt à envoyer — non soumis (mode essai). Bouton : « ${libelle} »${cvFile ? ', CV joint' : ''}.`,
      screenshot: await capture(),
    };
  }

  // Plusieurs écrans possibles : on avance tant qu'un bouton d'envoi répond,
  // et on s'arrête net à la confirmation.
  let texte = '';
  for (let etape = 0; etape < 5; etape += 1) {
    if (!(await bouton().isVisible().catch(() => false))) break;

    await bouton().click().catch(() => {});
    await humanPause(2500, 4000);

    texte = await page.innerText('body').catch(() => '');
    if (confirmPattern.test(texte)) {
      return {
        status: 'sent',
        message: cvJoint ? 'Candidature envoyée, CV joint.' : 'Candidature envoyée.',
      };
    }

    // Écran suivant : il peut porter le champ CV, ou ses propres questions.
    const suivant = await trouverFormulaire(page);
    if (!suivant) continue;

    const pas = await traiterEcran(suivant);
    if (pas.erreur) {
      /*
       * Bloqué **après** avoir déjà appuyé sur envoyer : on ne sait pas si la
       * candidature est partie.
       *
       * Constaté en vrai : HelloWork enregistre la candidature dès le premier
       * écran, puis propose un questionnaire complémentaire. Rester coincé
       * dessus n'empêche rien — le recruteur a déjà reçu le dossier. Annoncer
       * un échec à ce stade est faux, et surtout dangereux : cela pousse à
       * recommencer, donc à candidater deux fois.
       */
      return {
        status: 'uncertain',
        message:
          `Candidature soumise, puis étape ${etape + 2} restée incomplète (${pas.erreur}) — ` +
          'à vérifier sur la plateforme avant toute nouvelle tentative.',
        screenshot: await capture(),
      };
    }
    cvJoint = cvJoint || pas.joint;
  }

  // Le bouton a été actionné sans qu'aucune confirmation ne s'affiche : même
  // prudence, on ne conclut ni à l'envoi ni à l'échec.
  return {
    status: 'uncertain',
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
