import { humanPause, dismissConsent, sessionOuverte } from './common.js';
import { applyForm, externalApplyUrl } from './applyForm.js';
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
 * Repère le bouton d'envoi **dans un document**, et le marque pour Playwright.
 *
 * Cette fonction est exécutée dans la page : elle ne doit rien capturer de son
 * entourage. Elle est exportée pour être éprouvée sur de vraies pages rendues,
 * seule façon de vérifier une lecture de DOM sans candidater pour de bon.
 *
 * Plutôt que de rendre un sélecteur — qui n'aurait rien d'unique — elle pose un
 * attribut sur l'élément trouvé : Playwright n'a plus qu'à cliquer dessus, dans
 * le cadre où il se trouve.
 *
 * Quand rien ne correspond, elle rend **ce qu'elle a vu** : les libellés de la
 * fenêtre ouverte. Un échec qui dit « il n'y avait que ceci » se corrige à la
 * lecture ; un échec muet se rediagnostique de zéro à chaque fois.
 */
export function repererEnvoi() {
  const ENVOI =
    /envoyer\s+(ma|la|votre)\s+candidature|valider\s+ma\s+candidature|confirmer\s+ma\s+candidature/i;
  // Dans la fenêtre déjà ouverte, un libellé court suffit : le contexte est
  // sans ambiguïté. Hors d'elle, il serait dangereux — d'où les deux passes.
  const COURT = /^\s*(envoyer|confirmer|valider|je postule)\s*$/i;
  const ANONYME = /^\s*(se connecter|cr[ée]er un compte|s'identifier)\s*$/i;

  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
  const lisible = (el) =>
    [
      el.innerText || el.textContent || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.value || '',
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const SELECTEUR =
    'a, button, [role="button"], input[type="submit"], input[type="button"]';
  const bulles = [...document.querySelectorAll('.dropdown-menu, [role="dialog"]')].filter(visible);
  const dansBulles = bulles.flatMap((b) => [...b.querySelectorAll(SELECTEUR)].filter(visible));

  // Passe 1 : le libellé complet, où qu'il soit — il ne peut désigner rien
  // d'autre. Passe 2 : un libellé court, mais seulement dans la fenêtre.
  const cible =
    [...document.querySelectorAll(SELECTEUR)].filter(visible).find((el) => ENVOI.test(lisible(el))) ||
    dansBulles.find((el) => COURT.test(lisible(el)));

  if (cible) {
    cible.setAttribute('data-fuj-envoi', '1');
    return { trouve: true, libelle: lisible(cible).slice(0, 80), anonyme: false };
  }

  /*
   * Pas de bouton d'envoi : la fenêtre est-elle celle d'un visiteur anonyme ?
   *
   * Connecté, le rappel des critères se termine par « Envoyer ma candidature ».
   * Déconnecté, la **même** fenêtre s'affiche — mêmes critères, même mise en
   * page — mais le bouton devient « Se connecter ». On ne lit que les boutons
   * et liens de la fenêtre : le mot « connexion » traîne dans le pied de page
   * de la quasi-totalité des sites, et s'y fier rendrait toute annonce anonyme.
   */
  const anonyme = dansBulles.some((el) => ANONYME.test(lisible(el)));

  return {
    trouve: false,
    anonyme,
    /*
     * Une fenêtre ouverte, même sans rien à cliquer, est un aboutissement.
     *
     * « Veuillez vous présenter directement à l'adresse suivante » n'a ni
     * bouton ni lien : sans ce drapeau, l'attente irait jusqu'à son terme —
     * vingt secondes perdues par annonce — pour un cas déjà tranché juste
     * après.
     */
    bulle: bulles.some((b) => (b.textContent || '').trim().length > 10),
    // Ce que la fenêtre proposait réellement, pour que l'échec soit lisible.
    libelles: [...new Set(dansBulles.map(lisible).filter(Boolean))].slice(0, 8),
  };
}

/**
 * Le même repérage, mais **dans tous les cadres de la page**.
 *
 * C'est le manque qui faisait échouer France Travail alors que la capture
 * d'écran du blocage montrait « Envoyer ma candidature » à l'écran : la
 * recherche ne portait que sur le document principal. Une fenêtre servie dans
 * un cadre séparé y est invisible, le remplissage générique ne trouvait aucun
 * champ, et le diagnostic devenait « aucun formulaire de candidature » — un
 * verdict qui accusait les sélecteurs alors que le bouton était là, à côté.
 *
 * On rend aussi le cadre : cliquer suppose de savoir où.
 */
export async function repererEnvoiPartout(page) {
  const vus = [];
  let anonyme = false;
  let bulle = false;

  for (const frame of page.frames()) {
    const bilan = await frame.evaluate(repererEnvoi).catch(() => null);
    if (!bilan) continue;
    if (bilan.trouve) return { ...bilan, frame };
    anonyme = anonyme || bilan.anonyme;
    bulle = bulle || bilan.bulle;
    vus.push(...(bilan.libelles || []));
  }

  return { trouve: false, anonyme, bulle, libelles: [...new Set(vus)].slice(0, 8), frame: null };
}

/**
 * Attend que « Postuler » ait fini d'ouvrir ce qu'il ouvre.
 *
 * Le bouton porte `data-async-trigger="true"` : son contenu arrive par une
 * requête, pas avec la page. Une pause fixe le rattrapait une fois sur deux.
 * On attend donc un **aboutissement** — le bouton d'envoi, ou une fenêtre non
 * vide — plutôt qu'une durée, et dans tous les cadres.
 */
export async function attendreBulle(page, timeout = 20_000) {
  const fin = Date.now() + timeout;
  let dernier = { trouve: false, anonyme: false, bulle: false, libelles: [], frame: null };

  while (Date.now() < fin) {
    dernier = await repererEnvoiPartout(page);
    if (dernier.trouve || dernier.anonyme || dernier.bulle) return dernier;
    await page.waitForTimeout(400);
  }
  return dernier;
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
    await attendreBulle(page);
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
      return {
        status: 'external',
        reason: RAISONS.REDIRECTION_EXTERNE,
        message: `Le recruteur reçoit les candidatures sur son propre site : ${versRecruteur}`,
        externalUrl: versRecruteur,
      };
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
     * Où est le bouton d'envoi ? La question se pose dans **tous les cadres**.
     *
     * C'est ce qui manquait. La capture d'écran du blocage montrait « Envoyer
     * ma candidature » en clair, et le robot concluait pourtant « aucun
     * formulaire de candidature sur la page » : la recherche ne portait que
     * sur le document principal, et ne voyait rien d'une fenêtre servie dans
     * un cadre séparé. Le diagnostic accusait les sélecteurs de l'annonce
     * alors que le bouton était affiché, à l'écran, au moment même.
     *
     * On lit aussi le libellé dans `aria-label` et `value`, pas seulement dans
     * le texte : France Travail habille son envoi tantôt en bouton, tantôt en
     * lien, et pas toujours avec du texte visible.
     */
    const envoi = await repererEnvoiPartout(page);

    /*
     * La fenêtre a deux visages, et il faut les distinguer.
     *
     * Connecté, le rappel des critères se termine par « Envoyer ma
     * candidature ». Déconnecté, la **même** fenêtre s'affiche — mêmes
     * critères, même mise en page — mais le bouton devient « Se connecter ».
     * Rien avant ce point ne les séparait : `isLoggedIn` avait répondu
     * « ouverte », le bouton « Postuler » existait, la fenêtre s'était ouverte.
     */
    if (!envoi.trouve && envoi.anonyme) {
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
     *
     * Le clic passe par l'attribut posé au repérage, dans le cadre où
     * l'élément a été trouvé — un sélecteur de page n'aurait pas su l'y
     * atteindre.
     */
    if (envoi.trouve) {
      const confirmer = envoi.frame.locator('[data-fuj-envoi="1"]').first();

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
            : `Prêt à envoyer — non soumis (mode essai). Bouton : « ${envoi.libelle} ». ` +
              "France Travail envoie le dossier de ton espace personnel : c'est ce CV-là " +
              "qui part, pas celui adapté à l'offre.",
          screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
        };
      }

      await confirmer.click().catch(() => {});
      await humanPause(3000, 4500);

      /*
       * La confirmation peut s'afficher dans le cadre plutôt que dans la page :
       * on lit les deux, sans quoi un envoi réussi repartirait en « à
       * vérifier » — le pire des verdicts, celui qui invite à renvoyer.
       */
      const dits = await Promise.all(
        page.frames().map((f) => f.innerText('body').catch(() => ''))
      );
      const CONFIRME =
        /candidature.*(envoy|transmis|enregistr)|merci pour votre candidature|votre candidature a bien/i;
      if (dits.some((t) => CONFIRME.test(t))) {
        return { status: 'sent', message: 'Candidature envoyée via France Travail.' };
      }
      // Pas de confirmation : un formulaire a pu s'ouvrir, on le laisse remplir.
    }

    const bilan = await applyForm(page, options);

    /*
     * Un échec qui dit ce qu'il a vu se corrige à la lecture.
     *
     * « Aucun formulaire de candidature » est vrai mais muet : il ne dit pas si
     * la fenêtre était vide, si elle proposait autre chose, ou si le libellé
     * du bouton a changé. En y joignant les libellés réellement présents, la
     * prochaine itération part d'un constat au lieu d'une enquête — c'est
     * exactement ce que l'historique des échecs doit accumuler.
     */
    if (bilan.reason === RAISONS.FORMULAIRE_ABSENT && envoi.libelles?.length) {
      return {
        ...bilan,
        message: `${bilan.message} La fenêtre de France Travail ne proposait que : ${envoi.libelles.join(' · ')}.`,
      };
    }
    return bilan;
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
