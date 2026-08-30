import { humanPause, dismissConsent, sessionOuverte } from './common.js';
import { applyForm, externalApplyUrl } from './applyForm.js';

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
      return {
        status: 'external',
        message: `Le recruteur reçoit les candidatures sur son propre site : ${externe}`,
        externalUrl: externe,
      };
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
    await humanPause(2000, 3000);

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
      return {
        status: 'external',
        message: `Le recruteur reçoit les candidatures sur son propre site : ${versRecruteur}`,
        externalUrl: versRecruteur,
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

      await confirmer.click().catch(() => {});
      await humanPause(3000, 4500);

      const texte = await page.innerText('body').catch(() => '');
      if (/candidature.*(envoy|transmis|enregistr)|merci pour votre candidature/i.test(texte)) {
        return { status: 'sent', message: 'Candidature envoyée via France Travail.' };
      }
      // Pas de confirmation : un formulaire a pu s'ouvrir, on le laisse remplir.
    }

    return await applyForm(page, options);
  } catch (error) {
    return { status: 'manual', message: `Candidature France Travail : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}
