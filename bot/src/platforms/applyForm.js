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
import { RAISONS, captchaPresent, cleQuestion } from './failures.js';

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
 * Libellés qui envoient pour de bon.
 *
 * Sert de garde-fou au mode essai : quoi qu'une plateforme déclare comme
 * bouton « intermédiaire », un libellé reconnu ici n'est jamais actionné en
 * essai. Un envoi ne se rattrape pas — un employeur ne « dé-reçoit » pas une
 * candidature.
 */
const ENVOI_FINAL =
  /envoyer|soumettre|submit|send|postuler maintenant|valider ma candidature|terminer/i;

/**
 * Le formulaire de candidature de la page, s'il y en a un.
 * Priorité au formulaire portant un champ fichier ; à défaut, celui qui porte
 * un champ e-mail — certaines plateformes reprennent le CV du profil.
 */
async function trouverFormulaire(page) {
  /*
   * On note tous les conteneurs plausibles et on garde le plus riche.
   *
   * Les `<form>` ne suffisent pas : LinkedIn ouvre un `<dialog>` sans balise de
   * formulaire, et Welcome to the Jungle laisse traîner deux dialogues *vides
   * et invisibles* en plus du vrai. Prendre « le dernier dialogue » y
   * choisissait une coquille : le remplissage ne trouvait rien, puis échouait
   * sur « bouton d'envoi introuvable » — un message qui désignait le mauvais
   * coupable.
   *
   * D'où les deux règles : ne considérer que ce qui est **visible**, et
   * préférer le conteneur qui porte un champ fichier, signe le plus sûr d'un
   * formulaire de candidature.
   */
  const candidats = page.locator('form, dialog, [role="dialog"]');
  const total = await candidats.count();

  let meilleur = null;
  let meilleureNote = 0;

  for (let i = 0; i < total; i += 1) {
    const item = candidats.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;

    const note = await item
      .evaluate((el) => {
        const champs = el.querySelectorAll(
          'input:not([type="hidden"]), textarea, select'
        ).length;
        if (!champs) return 0;
        return champs + (el.querySelector('input[type="file"]') ? 100 : 0);
      })
      .catch(() => 0);

    if (note > meilleureNote) {
      meilleureNote = note;
      meilleur = item;
    }
  }

  return meilleur;
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

/**
 * Les champs obligatoires encore vides — hors champs fichier (cf. plus bas).
 *
 * `[required]` seul ne suffit pas : LinkedIn n'emploie que `aria-required`, et
 * ses champs manquants passaient donc inaperçus jusqu'à ce que la plateforme
 * refuse l'écran sans qu'on sache pourquoi.
 *
 * Ce qui est rendu, ce sont les **libellés**, pas les `name` ni les `id` : les
 * identifiants de LinkedIn ressemblent à « «rb» » et n'apprennent rien à
 * personne, là où « Mobile phone number » se corrige tout de suite.
 */
const manquants = (formulaire) =>
  formulaire
    .evaluate((form) => {
      const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const obligatoire = (el) =>
        el.required || el.getAttribute('aria-required') === 'true';
      const nommer = (el) =>
        (
          el.labels?.[0]?.textContent ||
          el.getAttribute('aria-label') ||
          el.placeholder ||
          el.name ||
          el.type ||
          ''
        )
          .replace(/\s+/g, ' ')
          .replace(/\*$/, '')
          .trim()
          .slice(0, 60);

      /*
       * On rend maintenant une description, pas seulement un libellé.
       *
       * Le libellé seul suffisait à écrire un message d'erreur. Il ne suffit
       * pas à *poser la question* à la personne : pour cela il faut aussi
       * savoir quelle forme attend le champ (un nombre, un téléphone, un choix
       * dans une liste) et, pour un `select`, les réponses possibles. Sans ça,
       * on demanderait « Niveau d'études » en texte libre là où la plateforme
       * n'accepte que quatre valeurs précises.
       */
      const decrire = (el) => {
        const options =
          el.tagName === 'SELECT'
            ? [...el.options]
                .map((o) => (o.textContent || '').trim())
                .filter((t) => t && !/^(choisir|s[ée]lectionner|--)/i.test(t))
                .slice(0, 25)
            : [];

        let forme = 'texte';
        if (el.tagName === 'SELECT') forme = 'choix';
        else if (el.type === 'checkbox') forme = 'case';
        else if (el.type === 'number') forme = 'nombre';
        else if (el.type === 'tel') forme = 'telephone';
        else if (el.type === 'date') forme = 'date';
        else if (el.tagName === 'TEXTAREA') forme = 'paragraphe';

        return { libelle: nommer(el), forme, options };
      };

      return [...form.querySelectorAll('input, textarea, select')]
        .filter((el) => el.type !== 'hidden' && visible(el) && obligatoire(el))
        .filter((el) => (el.type === 'checkbox' ? !el.checked : el.type !== 'file' && !el.value))
        .map(decrire)
        .filter((champ) => champ.libelle)
        .slice(0, 8);
    })
    .catch(() => []);

/**
 * Remplit les champs restants à partir des réponses déjà données.
 *
 * C'est ici que se joue l'apprentissage : la première rencontre avec « Années
 * d'expérience » échoue et pose la question ; une fois répondue, toutes les
 * candidatures suivantes qui la reposent la remplissent seules. Le
 * rapprochement se fait sur le libellé normalisé — le même que celui sous
 * lequel la réponse a été enregistrée.
 */
async function remplirDepuisReponses(formulaire, reponses) {
  if (!reponses || !Object.keys(reponses).length) return [];

  return formulaire
    .evaluate(
      (form, table) => {
        const cle = (texte) =>
          String(texte || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 60);

        const nommer = (el) =>
          (
            el.labels?.[0]?.textContent ||
            el.getAttribute('aria-label') ||
            el.placeholder ||
            el.name ||
            ''
          )
            .replace(/\s+/g, ' ')
            .replace(/\*$/, '')
            .trim();

        const remplis = [];
        for (const el of form.querySelectorAll('input, textarea, select')) {
          if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'file') continue;
          if (el.type !== 'checkbox' && el.value) continue;

          const valeur = table[cle(nommer(el))];
          if (valeur === undefined || valeur === null || valeur === '') continue;

          if (el.type === 'checkbox') {
            // Une réponse « non » à une case obligatoire ne doit pas la cocher
            // en douce : on respecte le refus et le champ restera signalé.
            if (!/^(oui|yes|true|1)$/i.test(String(valeur))) continue;
            if (!el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              remplis.push(nommer(el));
            }
            continue;
          }

          if (el.tagName === 'SELECT') {
            // On vise l'option dont le texte correspond, pas sa position :
            // l'ordre d'une liste change d'une annonce à l'autre.
            const cible = [...el.options].find(
              (o) => cle(o.textContent) === cle(valeur) || o.value === valeur
            );
            if (!cible) continue;
            el.value = cible.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            remplis.push(nommer(el));
            continue;
          }

          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
          Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, String(valeur));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          remplis.push(nommer(el));
        }
        return remplis;
      },
      reponses
    )
    .catch(() => []);
}

/**
 * Candidate sur le formulaire de la page courante.
 *
 * @param page          Onglet déjà positionné sur l'annonce, formulaire ouvert.
 * @param cvFile        { name, mimeType, buffer } — le PDF à joindre.
 * @param applicant     { firstName, lastName, email, phone }
 * @param coverLetter   Lettre de motivation.
 * @param dryRun        Remplir jusqu'au bouton d'envoi, sans appuyer.
 * @param submitSelector Sélecteurs d'envoi, du plus sûr au plus large.
 * @param submitText    Libellé du bouton d'action, quand il n'a ni `type=submit`
 *                      ni `aria-label` exploitable.
 * @param confirmPattern Ce que la page doit dire pour qu'on parle d'envoi.
 */
export async function applyForm(
  page,
  {
    cvFile,
    applicant = {},
    coverLetter,
    dryRun = false,
    /*
     * Réponses déjà données par la personne, indexées par libellé normalisé.
     * Alimentées par la page « Informations demandées » : c'est ce qui fait
     * qu'une question posée une fois ne bloque plus jamais.
     */
    answers = {},
    submitSelector = '[data-cy="submitButton"], button[type="submit"], input[type="submit"]',
    submitText = null,
    advanceText = null,
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
    let depose = false;
    const upload = scope.locator('input[type="file"]').first();

    if (cvFile && (await upload.count())) {
      await upload.setInputFiles(cvFile).catch(() => {});
      depose = true;
    } else if (cvFile) {
      /*
       * Pas de champ fichier ? Il n'existe peut-être pas *encore*.
       *
       * L'écran « Resume » de LinkedIn n'en contient aucun : il affiche un
       * bouton « Importer le CV » qui ouvre le sélecteur de fichiers du
       * système. On concluait donc « aucun champ pour joindre le CV » sur
       * l'écran même qui sert à le joindre, et la candidature serait partie
       * avec le CV que LinkedIn garde en mémoire — pas celui qu'on vient
       * d'adapter à l'offre.
       *
       * `filechooser` est la façon dont Playwright intercepte ce sélecteur :
       * le fichier est fourni sans qu'aucune fenêtre système ne s'ouvre.
       */
      const declencheur = scope
        .getByRole('button', {
          name: /importer|t[ée]l[ée]verser|upload|charger|joindre|ajouter (un )?cv/i,
        })
        .first();

      if (await declencheur.isVisible().catch(() => false)) {
        const [selecteur] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
          declencheur.click().catch(() => {}),
        ]);

        if (selecteur) {
          await selecteur.setFiles(cvFile).catch(() => {});
          depose = true;
        } else {
          // Certains sites se contentent de créer le champ au clic.
          const apparu = scope.locator('input[type="file"]').first();
          if (await apparu.count()) {
            await apparu.setInputFiles(cvFile).catch(() => {});
            depose = true;
          }
        }
        await humanPause(600, 1200);
      }
    }

    if (depose) {

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
        return {
          erreur: 'CV non accepté par la plateforme : envoi interrompu.',
          raison: RAISONS.CV_REFUSE,
        };
      }
    }

    // Les réponses connues passent avant le constat de manque : c'est tout
    // l'intérêt de les avoir demandées.
    await remplirDepuisReponses(scope, answers);
    await cocherCases(scope);
    await humanPause(400, 900);

    const vides = await manquants(scope);
    if (vides.length) {
      return {
        erreur: `Champs obligatoires non renseignés : ${vides.map((c) => c.libelle).join(', ')}.`,
        raison: RAISONS.CHAMPS_MANQUANTS,
        champs: vides.map((champ) => ({ ...champ, cle: cleQuestion(champ.libelle) })),
      };
    }

    return { joint };
  }

  /*
   * Un contrôle anti-robot se constate avant tout le reste.
   *
   * Sans cette vérification, la page de contrôle était traitée comme une page
   * d'annonce ordinaire : on n'y trouvait pas de formulaire, et l'échec était
   * classé « formulaire absent ». Le diagnostic désignait le mauvais coupable,
   * et surtout il laissait croire à un défaut de sélecteur réparable — alors
   * qu'aucun sélecteur n'aurait aidé.
   */
  if (await captchaPresent(page)) {
    return {
      status: 'manual',
      reason: RAISONS.CAPTCHA,
      message:
        'Contrôle anti-robot sur la page : la candidature doit être terminée à la main ' +
        'depuis la reprise en main.',
      screenshot: await capture(),
    };
  }

  const premier = await trouverFormulaire(page);
  if (!premier) {
    return {
      status: 'manual',
      reason: RAISONS.FORMULAIRE_ABSENT,
      message: "Aucun formulaire de candidature sur la page : à faire depuis l'annonce.",
      screenshot: await capture(),
    };
  }

  const etat = await traiterEcran(premier);
  if (etat.erreur) {
    return {
      status: 'manual',
      reason: etat.raison || RAISONS.INCONNU,
      fields: etat.champs || [],
      message: etat.erreur,
      screenshot: await capture(),
    };
  }
  let cvJoint = etat.joint;

  /*
   * Le bouton d'action de l'écran courant.
   *
   * Deux façons de le reconnaître, parce qu'une seule ne suffit pas : par
   * sélecteur (`type=submit`, attributs propres au site) et par libellé. Le
   * « Suivant » de LinkedIn n'a ni `type=submit` ni `aria-label` — aucun
   * sélecteur ne pouvait l'attraper, et le robot annonçait « bouton d'envoi
   * introuvable » sur un écran qui en affichait un.
   *
   * On cherche d'abord **dans le conteneur** du formulaire, où il se trouve
   * presque toujours, et on n'élargit à la page entière qu'à défaut : les
   * parcours en plusieurs écrans posent parfois le bouton hors du `<form>`, et
   * chercher large d'emblée risquait d'attraper un bouton de pied de page.
   */
  const boutonDans = (portee) => {
    const parSelecteur = portee.locator(submitSelector);
    return submitText
      ? parSelecteur.or(portee.getByRole('button', { name: submitText })).last()
      : parSelecteur.last();
  };

  // La portée suit le parcours : chaque écran a son conteneur, et le bouton du
  // suivant ne se cherche pas dans celui du précédent.
  let portee = premier;
  const bouton = async () => {
    const dedans = boutonDans(portee);
    return (await dedans.isVisible().catch(() => false)) ? dedans : boutonDans(page);
  };
  if (!(await (await bouton()).isVisible().catch(() => false))) {
    return {
      status: 'manual',
      reason: RAISONS.BOUTON_ABSENT,
      message: "Bouton d'envoi introuvable sur la page.",
      screenshot: await capture(),
    };
  }

  if (dryRun) {
    /*
     * L'essai traverse les écrans intermédiaires, jamais le dernier.
     *
     * Sans cela, l'essai s'arrêtait au premier écran et ne pouvait rien dire du
     * CV : la candidature simplifiée de LinkedIn commence par les coordonnées
     * et ne propose le fichier qu'à l'étape suivante. On concluait « aucun
     * champ pour joindre le CV » sur un parcours parfaitement valide.
     *
     * Une seule règle protège l'essai, et elle est absolue : on ne clique que
     * des libellés déclarés comme intermédiaires par la plateforme, et jamais
     * un libellé d'envoi. Un doute sur un bouton = on s'arrête.
     */
    let etapes = 0;
    while (advanceText && etapes < 4) {
      const suite = boutonDans(portee).and(page.getByRole('button', { name: advanceText }));
      const visible = await suite.isVisible().catch(() => false);
      if (!visible) break;

      const nom = (await suite.innerText().catch(() => '')).trim();
      if (!nom || ENVOI_FINAL.test(nom)) break;

      await suite.click().catch(() => {});
      await humanPause(1800, 2800);
      etapes += 1;

      const ecran = await trouverFormulaire(page);
      if (!ecran) break;
      portee = ecran;

      const pas = await traiterEcran(ecran);
      if (pas.erreur) {
        return {
          status: 'manual',
          reason: pas.raison || RAISONS.INCONNU,
          fields: pas.champs || [],
          message: `Essai interrompu à l'étape ${etapes + 1} : ${pas.erreur}`,
          screenshot: await capture(),
        };
      }
      cvJoint = cvJoint || pas.joint;
    }

    // Le CV est le point qui décide de la valeur d'une candidature : le dire
    // explicitement évite de croire un essai concluant alors qu'il partirait nu.
    const libelle = (await (await bouton()).innerText().catch(() => '?')).trim();
    const parcours = etapes ? ` (${etapes + 1} écrans parcourus)` : '';

    return {
      status: cvFile && !cvJoint ? 'manual' : 'dry-run',
      ...(cvFile && !cvJoint ? { reason: RAISONS.CV_SANS_CHAMP } : {}),
      message:
        cvFile && !cvJoint
          ? `Formulaire prêt${parcours}, mais aucun champ pour joindre le CV (bouton « ${libelle} ») : à vérifier avant d'activer l'envoi.`
          : `Prêt à envoyer — non soumis (mode essai)${parcours}. Bouton : « ${libelle} »${cvFile ? ', CV joint' : ''}.`,
      screenshot: await capture(),
    };
  }

  // Plusieurs écrans possibles : on avance tant qu'un bouton d'envoi répond,
  // et on s'arrête net à la confirmation.
  let texte = '';
  for (let etape = 0; etape < 5; etape += 1) {
    if (!(await (await bouton()).isVisible().catch(() => false))) break;

    await (await bouton()).click().catch(() => {});
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
    portee = suivant;

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
        reason: RAISONS.POST_ENVOI_INCOMPLET,
        // Les champs restent utiles : c'est ce qui manquait au questionnaire
        // complémentaire, et donc ce qu'il faudra savoir la prochaine fois.
        fields: pas.champs || [],
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
    reason: RAISONS.SANS_CONFIRMATION,
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
      const externe = (href) => {
        try {
          const url = new URL(href);
          return /^https?:$/.test(url.protocol) && !url.hostname.endsWith(interne);
        } catch {
          return false;
        }
      };

      const liens = [...document.querySelectorAll('a[href]')].filter((el) => externe(el.href));

      // 1. Le lien se nomme lui-même : « Postuler », « Apply »…
      const parLibelle = liens.find((el) =>
        /postuler|candidater|apply/i.test((el.textContent || '').trim())
      );
      if (parLibelle) return parLibelle.href;

      /*
       * 2. Le lien porte le nom de l'employeur, et c'est son *entourage* qui
       *    dit à quoi il sert.
       *
       * France Travail en est l'exemple : cliquer « Postuler » ouvre une bulle
       * « Postuler sur le site du recruteur » dont l'unique lien s'appelle
       * « ADECCO » ou « HEXAFRET ». Ne regarder que le libellé du lien laissait
       * passer ces annonces, et le robot concluait « Aucun formulaire de
       * candidature sur la page » — un message qui désignait le mauvais
       * coupable et donnait à croire à un bug de sélecteur.
       *
       * On remonte donc quelques niveaux au-dessus du lien pour lire l'intention
       * annoncée. Trois niveaux suffisent en pratique et évitent de remonter
       * jusqu'au corps de page, où le mot « postuler » finit toujours par
       * apparaître quelque part.
       */
      const INTENTION =
        /postuler sur|candidater sur|site du recruteur|site de l['’]employeur|site de l['’]entreprise|apply on (the )?(company|employer)/i;

      /*
       * On part de la phrase, pas du lien.
       *
       * Remonter depuis le lien en comptant les niveaux ne marche pas : chez
       * France Travail, le titre de la bulle et le lien sont séparés par cinq
       * générations (`div > div > ul > li > div > a`), et une limite assez
       * haute pour les couvrir finit par atteindre le corps de la page, où le
       * mot « postuler » apparaît toujours quelque part.
       *
       * On cherche donc l'élément qui *porte* la phrase — court, donc précis —
       * puis on redescend chercher le lien sous ses ancêtres proches.
       */
      const titres = [...document.querySelectorAll('p, h1, h2, h3, h4, span, div, strong')]
        .filter((el) => {
          const texte = el.textContent || '';
          return texte.length < 120 && INTENTION.test(texte);
        });

      for (const titre of titres) {
        let portee = titre.parentElement;
        for (let niveau = 0; niveau < 4 && portee; niveau += 1) {
          const trouve = [...portee.querySelectorAll('a[href]')].find((el) => externe(el.href));
          if (trouve) return trouve.href;
          portee = portee.parentElement;
        }
      }

      return null;
    }, hote)
    .catch(() => null);
}
