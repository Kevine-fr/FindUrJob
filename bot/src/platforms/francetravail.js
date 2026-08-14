import { humanPause, dismissConsent } from './common.js';
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
    await page.goto('https://candidat.francetravail.fr/espacepersonnel/', {
      waitUntil: 'commit',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);
    // Sans session, le site renvoie vers son service d'authentification.
    return !/authentification|connexion|\/login/i.test(page.url());
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
export async function login() {
  return {
    status: 'manual',
    message:
      'France Travail demande une authentification renforcée (code par courriel ou SMS). ' +
      'Ouvre la reprise en main pour te connecter une fois : la session est ensuite conservée.',
  };
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
        status: 'manual',
        message: `Le recruteur reçoit les candidatures sur son propre site : ${externe}`,
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

    await postuler.click().catch(() => {});
    await humanPause(2000, 3000);

    return await applyForm(page, options);
  } catch (error) {
    return { status: 'manual', message: `Candidature France Travail : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}
