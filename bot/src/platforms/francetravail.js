import { humanPause, dismissConsent, sessionOuverte } from './common.js';
import { applyForm, externalApplyUrl, postulerSurSiteExterne } from './applyForm.js';
import { RAISONS, raisonTechnique } from './failures.js';

/**
 * France Travail — candidature seulement.
 *
 * La **recherche** passe par l'API officielle, côté moteur Python : c'est le
 * chemin prévu, il est stable et ne demande aucune session. Ce module n'existe
 * donc que pour l'autre moitié du travail — postuler — qui, elle, réclame
 * l'espace personnel du candidat.
 *
 * La connexion ne s'automatise pas : France Travail applique une
 * authentification renforcée (code envoyé par courriel ou SMS) qu'on ne peut ni
 * deviner ni contourner. On oriente donc vers la reprise en main, où la
 * personne termine elle-même. Une fois la session ouverte, elle tient, et les
 * candidatures repartent seules.
 */

export const name = 'francetravail';
export const loginUrl = 'https://candidat.francetravail.fr/espacepersonnel/';
export const needsSessionToSearch = false;

/** La recherche ne passe pas par ici : l'API officielle fait mieux. */
export async function search() {
  const err = new Error(
    "France Travail se recherche par son API officielle, pas au navigateur : " +
      'renseigne les clés du moteur IA.'
  );
  err.status = 400;
  throw err;
}

export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    /*
     * La redirection vers `authentification-candidat.francetravail.fr` prend
     * plus de trois secondes. L'ancien contrôle jugeait l'URL avant qu'elle
     * n'aboutisse et rendait « connectée » une session morte depuis des jours :
     * les candidatures partaient vers un mur, et la relance automatique de
     * session ne se déclenchait jamais, faute de 409.
     */
    return await sessionOuverte(
      page,
      'https://candidat.francetravail.fr/espacepersonnel/',
      /authentification|connexion|\/login/i
    );
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * La bulle « Postuler » est-elle celle d'un visiteur non connecté ?
 *
 * Exportée pour être éprouvable : c'est une lecture de DOM, et la seule façon
 * d'en vérifier la justesse est de la confronter aux deux variantes réelles de
 * la bulle. Laissée en ligne dans `apply`, elle n'aurait pu être testée qu'en
 * candidatant pour de bon.
 *
 * On lit les **boutons et liens**, jamais le texte entier : le mot
 * « connexion » traîne dans le pied de page de la quasi-totalité des sites, et
 * s'y fier ferait déclarer toute annonce anonyme.
 *
 * Le motif est ancré (`^…$`) : « Se connecter » est un bouton, tandis que
 * « Vous pouvez créer un compte même si vous n'êtes pas inscrit » est une
 * phrase d'aide qui ne doit rien déclencher.
 */
export async function bulleAnonyme(page) {
  return page
    .evaluate(() => {
      const zones = [...document.querySelectorAll('.dropdown-menu, [role="dialog"]')].filter(
        (el) => el.offsetParent !== null
      );
      return zones.some((zone) =>
        [...zone.querySelectorAll('a, button')].some((el) =>
          /^\s*(se connecter|cr[ée]er un compte|s'identifier)\s*$/i.test(el.textContent || '')
        )
      );
    })
    .catch(() => false);
}

/**
 * L'écran « Vous êtes connecté », et la confiance accordée au navigateur.
 *
 * France Travail termine sa connexion par une page de confirmation qui propose
 * « Faire confiance à ce navigateur » — et annonce, en toutes lettres, que la
 * vérification d'identité ne sera plus demandée pendant trois mois.
 *
 * Cliquer ce bouton est ce qui rend la session durable. Sans lui, chaque
 * expiration relance une authentification renforcée, dont le code n'arrive que
 * chez la personne : la campagne se retrouve bloquée sur France Travail tous
 * les quelques jours, sans rien pouvoir faire seule.
 *
 * C'est un réglage du compte, pas un contournement : la case existe pour ça, et
 * le profil du navigateur piloté est dédié à cette personne. Le message de
 * retour le dit explicitement, pour que le choix ne soit pas invisible.
 *
 * @returns {null|{confiance: boolean}} `null` si ce n'est pas cet écran.
 */
export async function confirmerNavigateur(page) {
  const texte = await page.innerText('body').catch(() => '');
  if (!/vous [êe]tes connect[ée]|tout est pr[êe]t/i.test(texte)) return null;

  const bouton = page
    .getByRole('button', { name: /faire confiance à ce navigateur/i })
    .or(page.getByRole('link', { name: /faire confiance à ce navigateur/i }))
    .first();

  if (!(await bouton.isVisible().catch(() => false))) return { confiance: false };

  await bouton.click().catch(() => {});
  // La confirmation renvoie vers l'espace personnel : on laisse la redirection
  // aboutir, sans quoi la page suivante serait interrogée pendant le saut.
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await humanPause(800, 1500);
  return { confiance: true };
}

/**
 * Pas d'automatisation ici, et c'est délibéré : l'authentification renforcée
 * de France Travail attend un code que seule la personne reçoit.
 */
export async function login(context, { email, password }) {
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Pas de redirection vers le service d'authentification : la session tient
    // encore. Rejouer le formulaire ne ferait que risquer une alerte inutile.
    if (!/authentification-candidat/.test(page.url())) {
      return { status: 'connected', message: 'Session France Travail déjà ouverte.' };
    }

    /*
     * Le formulaire est stable : `#identifiant` et `#password`, avec des `name`
     * génériques (`callback_0`, `callback_1`) hérités de son moteur
     * d'authentification. On vise les deux, l'identifiant en premier.
     *
     * L'« identifiant » est un numéro à onze chiffres, pas une adresse : c'est
     * ce que France Travail réclame, et c'est ce que l'onglet Comptes demande.
     */
    const identifiant = page.locator('#identifiant, input[name="callback_0"]').first();
    try {
      await identifiant.waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      return {
        status: 'verification',
        message:
          "Le formulaire de connexion France Travail n'est pas accessible. " +
          'Termine la connexion depuis la reprise en main.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    await identifiant.fill(email);
    await humanPause(300, 800);
    await page.locator('#password, input[name="callback_1"]').first().fill(password);
    await humanPause(400, 900);

    await page.getByRole('button', { name: /se connecter/i }).first().click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await humanPause(2000, 3000);

    /*
     * L'authentification renforcée n'arrive pas à chaque fois — c'est bien pour
     * cela que la connexion vaut la peine d'être tentée. Quand elle arrive, on
     * s'arrête : un code envoyé par courriel ou SMS ne se devine pas, et
     * s'acharner déclencherait surtout une alerte de sécurité sur le compte.
     */
    const texte = await page.innerText('body').catch(() => '');
    if (/code (de )?(v[ée]rification|s[ée]curit[ée])|nous vous avons envoy|double authentification/i.test(texte)) {
      return {
        status: 'verification',
        message:
          'France Travail demande un code de vérification (courriel ou SMS). ' +
          'Ouvre la reprise en main pour le saisir : la session tient ensuite.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    /*
     * L'écran de succès vit **sur le domaine d'authentification**, et c'est ce
     * qui faisait passer une connexion réussie pour un échec.
     *
     * Après validation, France Travail affiche « Vous êtes connecté — Tout est
     * prêt ! » sur `authentification-candidat.francetravail.fr`. Le contrôle
     * d'URL juste en dessous y voyait la preuve d'un refus et rendait
     * « vérification requise » : la session était pourtant ouverte, mais
     * personne ne le savait, et la campagne n'essayait même pas de postuler.
     */
    const confirme = await confirmerNavigateur(page);
    if (confirme) {
      return {
        status: 'connected',
        message: confirme.confiance
          ? 'Session France Travail ouverte, et ce navigateur est désormais reconnu ' +
            'pour trois mois : plus de code de vérification à saisir d’ici là.'
          : 'Session France Travail ouverte.',
        url: page.url(),
      };
    }

    if (/authentification-candidat/.test(page.url())) {
      return {
        status: 'verification',
        message:
          "France Travail n'a pas validé la connexion : vérifie l'identifiant (onze " +
          'chiffres) et le mot de passe, ou termine depuis la reprise en main.',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    return { status: 'connected', message: 'Session France Travail ouverte.', url: page.url() };
  } catch (error) {
    return { status: 'manual', message: `Connexion France Travail : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function apply(context, offer, options = {}) {
  const page = await context.newPage();
  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'commit', timeout: 45_000 });
    await dismissConsent(page);
    await page.waitForTimeout(3000);

    // Beaucoup d'annonces France Travail redirigent vers le site du recruteur
    // ou demandent un envoi par courriel : ni l'un ni l'autre ne s'automatise.
    const externe = await externalApplyUrl(page, 'francetravail.fr');
    if (externe) {
      return await postulerSurSiteExterne(page, externe, options);
    }

    const postuler = page.getByRole('button', { name: /postuler|je postule|candidater/i }).first();
    if (!(await postuler.count())) {
      return {
        status: 'manual',
        message:
          "Aucun bouton « Postuler » sur l'annonce : session France Travail fermée, " +
          'ou candidature à envoyer par un autre moyen (téléphone, courriel).',
      };
    }

    /*
     * En mode essai, on coupe toute écriture avant de toucher quoi que ce soit.
     *
     * France Travail n'ouvre pas un formulaire : il affiche un rappel des
     * critères de l'offre, avec un bouton « Envoyer ma candidature » dont on ne
     * peut pas savoir, de l'extérieur, s'il envoie sur-le-champ. Plutôt que de
     * deviner, on avorte tout ce qui n'est pas une lecture : la confirmation
     * peut alors être franchie pour voir ce qu'il y a derrière, sans qu'aucune
     * candidature ne puisse atteindre le recruteur.
     */
    await postuler.click().catch(() => {});

    /*
     * Ce que « Postuler » ouvre est chargé en asynchrone : on l'attend.
     *
     * Le bouton porte `data-async-trigger="true"` — son contenu arrive par une
     * requête, pas avec la page. Une pause fixe de deux à trois secondes le
     * rattrapait parfois et le manquait le reste du temps : mesuré sur dix
     * annonces, cinq repartaient en « aucun formulaire de candidature » alors
     * que le contenu s'affichait une demi-seconde à trois secondes après le
     * clic. Le diagnostic était donc faux une fois sur deux, et une annonce
     * parfaitement candidatable était comptée en échec.
     *
     * On attend l'un des deux aboutissements possibles — le rappel des
     * critères, ou la bulle vers le site du recruteur — plutôt qu'une durée.
     */
    await page
      .waitForFunction(
        () => {
          if (/envoyer ma candidature/i.test(document.body.innerText || '')) return true;
          return [...document.querySelectorAll('.dropdown-menu, [role="dialog"]')].some(
            (el) => el.offsetParent !== null && (el.textContent || '').trim().length > 10
          );
        },
        undefined,
        { timeout: 20_000 }
      )
      .catch(() => {});
    await humanPause(400, 900);

    /*
     * Beaucoup d'annonces ne se candidatent pas ici, et on ne l'apprend
     * qu'**après** avoir cliqué.
     *
     * « Postuler » n'envoie pas toujours vers un formulaire : il ouvre parfois
     * une bulle « Postuler sur le site du recruteur » avec un seul lien, dont
     * le libellé est le nom de l'employeur (« ADECCO », « HEXAFRET »). Le
     * contrôle d'avant le clic ne pouvait rien voir — la bulle n'existait pas
     * encore — et le parcours se poursuivait jusqu'à « Aucun formulaire de
     * candidature sur la page », qui accusait à tort les sélecteurs.
     *
     * Mesuré sur un échantillon d'annonces réelles : deux sur six.
     */
    const versRecruteur = await externalApplyUrl(page, 'francetravail.fr');
    if (versRecruteur) {
      return await postulerSurSiteExterne(page, versRecruteur, options);
    }

    /*
     * Certaines annonces ne se candidatent pas en ligne, et c'est voulu.
     *
     * « Veuillez vous présenter directement à l'adresse suivante » — un forum
     * de recrutement, un employeur qui reçoit sur place, ou qui ne veut qu'un
     * courriel. Il n'y a pas de formulaire à trouver : en chercher un menait à
     * « aucun formulaire de candidature », qui laissait croire à un défaut de
     * sélecteur et invitait à relancer une candidature impossible.
     *
     * On rend la consigne telle que la plateforme l'écrit : c'est elle qui dit
     * quoi faire, et elle tient en une phrase.
     */
    const consigne = await page
      .evaluate(() => {
        const MOTIF =
          /vous pr[ée]senter directement|se pr[ée]senter|candidature (par|uniquement par) (courrier|t[ée]l[ée]phone|mail)|adresser votre candidature par/i;
        const zone = [...document.querySelectorAll('.dropdown-menu, [role="dialog"]')].find(
          (el) => el.offsetParent !== null && MOTIF.test(el.textContent || '')
        );
        return zone ? (zone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) : null;
      })
      .catch(() => null);

    if (consigne) {
      return {
        status: 'external',
        reason: RAISONS.REDIRECTION_EXTERNE,
        message: `Cette annonce ne se candidate pas en ligne — ${consigne}`,
      };
    }

    /*
     * La bulle a deux visages, et c'est là que tout se jouait.
     *
     * Connecté, le rappel des critères se termine par « Envoyer ma
     * candidature ». Déconnecté, la **même** bulle s'affiche — mêmes critères,
     * même mise en page — mais le bouton devient « Se connecter », suivi de
     * « Vous n'avez pas de compte ? Créer un compte ».
     *
     * Rien avant ce point ne permettait de les distinguer : la vérification de
     * session d'`isLoggedIn` avait répondu « ouverte », le bouton « Postuler »
     * existait, la bulle s'était ouverte. Le parcours continuait donc jusqu'au
     * remplissage générique, qui ne trouvait aucun champ et concluait « aucun
     * formulaire de candidature sur la page » — un diagnostic qui accusait les
     * sélecteurs alors que la cause était une session fermée.
     *
     * C'est pourquoi France Travail ne postulait jamais : l'échec était réel,
     * mais réparable, et personne ne pouvait le savoir.
     */
    if (await bulleAnonyme(page)) {
      /*
       * `session` est traduit en 409 par le serveur du robot, ce qui déclenche
       * la reprise de session déjà en place côté API : on rouvre, puis on
       * réessaie une fois. Rendre un simple échec aurait laissé la candidature
       * morte alors qu'il suffit de se reconnecter.
       */
      return {
        status: 'session',
        reason: RAISONS.SESSION_EXPIREE,
        message:
          'France Travail affiche « Se connecter » au moment de postuler : la session était ' +
          'fermée malgré le contrôle préalable.',
      };
    }

    /*
     * Le rappel des critères porte le vrai bouton d'envoi. Il n'y a rien à
     * remplir : France Travail joint le dossier de l'espace personnel.
     */
    // Cherché sur le texte et non sur le rôle : France Travail habille son
    // envoi en lien, pas en bouton, et `getByRole('button')` passait à côté.
    const confirmer = page
      .locator('a, button, [role="button"]')
      .filter({ hasText: /envoyer ma candidature/i })
      .first();
    if (await confirmer.count()) {
      if (options.dryRun) {
        /*
         * Le filet ne se pose qu'ici, et pas plus tôt : la fenêtre de rappel
         * a elle-même besoin d'appels au serveur pour s'afficher. Coupée dès
         * l'ouverture de la page, elle ne paraissait jamais — et l'essai
         * concluait qu'il n'y avait pas de candidature possible.
         */
        await page.route('**/*', (route) => {
          const methode = route.request().method();
          return methode === 'GET' || methode === 'OPTIONS' ? route.continue() : route.abort();
        });
        await confirmer.click().catch(() => {});
        await humanPause(2500, 3500);

        // Un formulaire derrière la confirmation ? Alors il y a de quoi joindre
        // notre CV, et c'est le remplisseur commun qui reprend la main.
        const suite = await page
          .locator('form input[type="file"], dialog input[type="file"]')
          .count()
          .catch(() => 0);

        return {
          status: 'dry-run',
          message: suite
            ? 'Prêt à envoyer — non soumis (mode essai). Un formulaire suit la confirmation : le CV adapté peut y être joint.'
            : "Prêt à envoyer — non soumis (mode essai). Bouton : « Envoyer ma candidature ». " +
              "France Travail envoie le dossier de ton espace personnel : c'est ce CV-là " +
              "qui part, pas celui adapté à l'offre.",
          screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        };
      }

      /*
       * « Envoyer ma candidature » ouvre un **nouvel onglet**.
       *
       * Le lien porte `target="_blank"` — son libellé accessible le dit
       * d'ailleurs : « (nouvelle fenêtre) ». On cliquait, la page d'origine
       * restait sur l'annonce, et le reste du parcours l'analysait elle : d'où
       * « Aucun formulaire de candidature sur la page », sur une candidature
       * dont le formulaire s'était ouvert à côté, invisible pour nous.
       *
       * Plutôt que de gérer un second onglet, on suit l'adresse dans celui-ci.
       * C'est la même destination — `/candidature/postulerenligne/<id>` — et le
       * parcours reste sur une seule page, donc analysable de bout en bout.
       */
      const versFormulaire = await confirmer.getAttribute('href').catch(() => null);
      if (versFormulaire) {
        await page
          .goto(new URL(versFormulaire, page.url()).href, {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          })
          .catch(() => {});
      } else {
        await confirmer.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
      }
      await page
        .waitForFunction(
          () =>
            /candidature.*(envoy|transmis|enregistr)|merci pour votre candidature|d[ée]j[àa] postul/i.test(
              document.body.innerText || ''
            ) || document.querySelectorAll('form input, form textarea').length > 0,
          undefined,
          { timeout: 20_000 }
        )
        .catch(() => {});
      await humanPause(600, 1200);

      const texte = await page.innerText('body').catch(() => '');

      /*
       * « Vous avez déjà postulé sur cette offre ! »
       *
       * Constaté en vrai : la candidature était partie lors d'un passage
       * précédent, sans qu'on ait su le voir. La compter en échec pousse à
       * recommencer — exactement ce qu'il ne faut pas faire.
       */
      if (/d[ée]j[àa] postul[ée]/i.test(texte)) {
        return {
          status: 'sent',
          message: 'France Travail a déjà reçu cette candidature.',
        };
      }

      /*
       * La page de candidature demande **quel CV** joindre.
       *
       * Des boutons radio `choix-cv` listent les CV du profil, puis un
       * `<button type="submit">Envoyer</button>` conclut. Aucun n'est marqué
       * `required`, mais rien ne part sans choix : le remplisseur générique, qui
       * ne coche que l'obligatoire, laissait donc le formulaire incomplet.
       */
      /*
       * Trois choses, et aucune n'est marquée obligatoire en HTML.
       *
       * Relevé sur le formulaire réel : un CV à choisir parmi ceux du profil,
       * une lettre de motivation dont seul le *libellé* dit « (obligatoire) »,
       * et une case « Je confirme que mes coordonnées ci-dessus sont valides ».
       *
       * Rien ne porte `required` ni `aria-required` : nos contrôles génériques
       * ne voyaient donc rien à signaler, le bouton « Envoyer » restait actif,
       * le clic partait — et la page ne bougeait pas, sans le moindre message
       * d'erreur. C'est ce silence qui rendait la panne si difficile à lire.
       */
      const choixCv = page.locator('input[name="choix-cv"]').first();
      if (await choixCv.count()) {
        await choixCv.check({ force: true }).catch(() => {});
        await humanPause(500, 1000);
      }

      const lettre = page.locator('textarea[name="textMessage"]').first();
      if (await lettre.count()) {
        await lettre
          .fill(
            options.coverLetter ||
              'Bonjour,\n\nVotre annonce a retenu mon attention et je vous adresse ma ' +
                'candidature. Vous trouverez mon parcours détaillé dans le CV joint.\n\n' +
                'Je reste disponible pour en échanger.\n\nCordialement.'
          )
          .catch(() => {});
        await humanPause(400, 900);
      }

      /*
       * La case se coche par son libellé, et on le vérifie.
       *
       * `check({ force: true })` sur l'input restait sans effet — la case
       * demeurait décochée, et « Envoyer » ne faisait rien, sans message. On
       * relit donc l'état plutôt que de supposer, et on passe par le `<label>`
       * quand la case n'a pas suivi : c'est ce qui marche sur cette page.
       */
      const confirmation = page.locator('input[name="confirmcoordonnees"]').first();
      if (await confirmation.count()) {
        await confirmation.check({ force: true }).catch(() => {});
        if (!(await confirmation.isChecked().catch(() => false))) {
          await page.locator('label[for="confirmcoordonnees"]').click({ force: true }).catch(() => {});
        }
        await humanPause(400, 900);
      }

      const envoyer = page.getByRole('button', { name: /^\s*envoyer\s*$/i }).first();
      if (!(await envoyer.count())) {
        return {
          status: 'manual',
          reason: RAISONS.BOUTON_ABSENT,
          message: "Page de candidature France Travail sans bouton « Envoyer ».",
          screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        };
      }

      await envoyer.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
      await humanPause(2000, 3000);

      /*
       * On demande à France Travail, au lieu de lire un message.
       *
       * Se fier au texte affiché avait produit un faux « envoyée » : la page du
       * formulaire contient elle-même les mots « candidature » et « envoyer »,
       * et le motif les rapprochait. Annoncer un envoi qui n'a pas eu lieu est
       * la pire erreur possible ici — la candidature est perdue et personne ne
       * le sait.
       *
       * La page « postuler en ligne » répond sans ambiguïté : elle affiche
       * « Vous avez déjà postulé sur cette offre ! » quand la candidature est
       * arrivée, et le formulaire sinon. C'est la plateforme qui tranche.
       */
      const identifiant = /detail\/([^/?#]+)/.exec(offer.sourceUrl || '')?.[1];
      if (identifiant) {
        await page
          .goto(`https://candidat.francetravail.fr/candidature/postulerenligne/${identifiant}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          .catch(() => {});
        await humanPause(1500, 2500);
        const verdict = await page.innerText('body').catch(() => '');
        if (/d[ée]j[àa] postul[ée]/i.test(verdict)) {
          return { status: 'sent', message: 'Candidature envoyée via France Travail (confirmée).' };
        }
      }

      return {
        status: 'uncertain',
        reason: RAISONS.SANS_CONFIRMATION,
        message:
          "Formulaire France Travail soumis, mais la plateforme ne confirme pas encore l'avoir " +
          'reçue : à vérifier dans « Mes candidatures ».',
        screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
      };
    }

    return await applyForm(page, options);
  } catch (error) {
    return {
      status: 'manual',
      reason: raisonTechnique(error),
      message: `Candidature France Travail : ${error.message}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Les candidatures que France Travail déclare avoir reçues.
 *
 * Cette page a longtemps été réputée inexistante ici — j'avais cherché sept
 * adresses plausibles et conclu qu'il n'y en avait pas. Elle existe : c'est
 * `/candidature/mescandidatures`, et on n'y arrive pas en devinant une URL mais
 * en suivant « Accéder à mes candidatures » depuis une annonce déjà candidatée.
 *
 * Ce qu'elle change est considérable : les envois France Travail aboutissaient
 * déjà — « Candidature envoyée le 03/09/2026 à 19h26 » — sans jamais être
 * reconnus comme tels faute de pouvoir le vérifier. Le rapprochement peut
 * désormais les promouvoir en « Postulé » au lieu de les laisser « à vérifier ».
 */
export async function listApplications(context, { max = 120 } = {}) {
  const page = await context.newPage();

  try {
    await page.goto('https://candidat.francetravail.fr/candidature/mescandidatures', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await dismissConsent(page);
    await page.waitForTimeout(5000);

    /*
     * On lit les blocs qui portent une date d'envoi.
     *
     * C'est le seul repère stable de cette liste : le titre et l'employeur
     * changent de balise au gré des refontes, mais « Candidature envoyée le … »
     * est la phrase qui définit une entrée. Elle sert donc à la fois à trouver
     * les blocs et à écarter l'entête et les filtres.
     */
    return await page.evaluate((limite) => {
      const ENVOI = /Candidature envoy[ée]e le\s+([0-9/]+)/i;
      const vus = new Set();
      const sortie = [];

      /*
       * L'entrée est un `<li class="candidature">`.
       *
       * Chercher « le plus petit bloc contenant la phrase » ne marchait pas :
       * la date vit dans un `<p class="description">` enfant, si bien que tout
       * conteneur était écarté comme « trop grand » et la liste ressortait
       * vide. On vise donc l'entrée elle-même, avec un repli sur les `li` qui
       * portent la phrase si la classe venait à changer.
       */
      let entrees = [...document.querySelectorAll('li.candidature, li[class*="candidature"]')];
      if (!entrees.length) {
        entrees = [...document.querySelectorAll('li')].filter((el) =>
          ENVOI.test((el.textContent || '').replace(/\s+/g, ' '))
        );
      }

      for (const el of entrees) {
        const texte = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!ENVOI.test(texte) || texte.length > 600) continue;

        const titre = (texte.split('(voir le détail')[0] || '').trim();
        const employeur = (/Employeur\s*:\s*([^0-9]+?)(?:\d{2}\s*-|$)/i.exec(texte) || [])[1] || '';
        const statut = (/EN COURS[^.]*|CANDIDATURE RETENUE|NON RETENUE|CL[OÔ]TUR[ÉE]E/i.exec(texte) || [])[0] || '';
        const cle = `${titre}|${employeur}`;
        if (!titre || vus.has(cle)) continue;
        vus.add(cle);

        sortie.push({
          titre,
          societe: employeur.trim(),
          statut: statut.trim(),
          url: el.querySelector('a[href]')?.href || '',
        });
        if (sortie.length >= limite) break;
      }
      return sortie;
    }, max);
  } finally {
    await page.close().catch(() => {});
  }
}
