import { normalize, humanPause, dismissConsent, sessionOuverte } from './common.js';
import { applyForm, externalApplyUrl } from './applyForm.js';

/**
 * APEC.
 *
 * Le site est une application Angular dont les résultats viennent d'un service
 * interne (`/cms/webservices/rechercheOffre`). On l'interroge directement : il
 * rend un JSON propre et complet, là où gratter le DOM reviendrait à courir
 * après des classes CSS générées.
 *
 * L'appel part **depuis une page apec.fr** : le service refuse les requêtes
 * dont l'origine ne correspond pas.
 */

const SEARCH_URL = 'https://www.apec.fr/cms/webservices/rechercheOffre';
const PER_PAGE = 20; // pagination imposée par le service

export const name = 'apec';
export const loginUrl = 'https://www.apec.fr/candidat/connexion.html';
export const needsSessionToSearch = false;

// Conventions « cadre » : ce que l'APEC coche par défaut sur son site.
const CONVENTIONS = ['143684', '143685', '143686', '143687', '143706'];

// Codes de contrat du service (relevés sur les réponses).
const CONTRACTS = { cdi: '101888', cdd: '101887', stage: '101890', alternance: '101892' };

/** Le lieu attendu est un code : on isole un département de « Paris - 75 ». */
function lieuCode(location) {
  const departement = /(\d{2,3})\s*$/.exec(String(location || '').trim());
  return departement ? [departement[1]] : [];
}

export async function search(context, query) {
  const wanted = Math.min(Math.max(1, query.limit || 25), 150);
  const page = await context.newPage();

  try {
    // Une page du domaine d'abord : c'est elle qui donne son origine à l'appel.
    await page.goto('https://www.apec.fr/candidat/recherche-emploi.html/emploi', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const contrats = (query.contractTypes || []).map((type) => CONTRACTS[type]).filter(Boolean);
    const collected = [];

    for (let start = 0; collected.length < wanted; start += PER_PAGE) {
      const body = {
        motsCles: (query.keywords || []).join(' '),
        lieux: lieuCode(query.location),
        fonctions: [],
        statutPoste: [],
        typesContrat: contrats,
        typesConvention: CONVENTIONS,
        niveauxExperience: [],
        idsEtablissement: [],
        secteursActivite: [],
        typesTeletravail: [],
        idNomZonesDeplacement: [],
        positionNumbersExcluded: [],
        typeClient: 'CADRE',
        sorts: [{ type: 'SCORE', direction: 'DESCENDING' }],
        pagination: { range: PER_PAGE, startIndex: start },
      };

      const batch = await page.evaluate(
        async ([url, payload]) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!response.ok) return { erreur: `HTTP ${response.status}` };
          return response.json();
        },
        [SEARCH_URL, body]
      );

      if (batch?.erreur) {
        if (collected.length) break;
        throw new Error(`APEC a refusé la recherche (${batch.erreur}).`);
      }

      const resultats = batch?.resultats || [];
      if (!resultats.length) break;
      collected.push(...resultats);

      if (resultats.length < PER_PAGE) break;
      await humanPause(500, 1200);
    }

    return collected.slice(0, wanted).map((item) =>
      normalize(
        {
          title: item.intitule,
          company: item.nomCommercial,
          location: item.lieuTexte,
          salary: item.salaireTexte,
          description: item.texteOffre,
          externalId: String(item.numeroOffre || ''),
          sourceUrl: item.numeroOffre
            ? `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${item.numeroOffre}`
            : '',
          // Le type de contrat arrive en code numérique : on retrouve le libellé.
          publishedAt: item.datePublication || item.dateValidation || undefined,
          contractHint:
            Object.entries(CONTRACTS).find(([, code]) => code === String(item.typeContrat))?.[0] ||
            '',
        },
        name
      )
    );
  } finally {
    await page.close().catch(() => {});
  }
}

/** L'espace candidat n'est atteignable qu'avec une session ouverte. */
export async function isLoggedIn(context) {
  const page = await context.newPage();
  try {
    return await sessionOuverte(
      page,
      'https://www.apec.fr/candidat/mon-espace.html',
      /connexion|authentification|login/i
    );
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function login(context, { email, password }) {
  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: 'commit', timeout: 45_000 });
    await dismissConsent(page);
    await humanPause();

    await page.fill('input[type="email"], input[name*="mail" i]', email);
    await humanPause(300, 700);
    await page.fill('input[type="password"]', password);
    await humanPause(300, 700);

    await page.getByRole('button', { name: /se connecter|connexion/i }).first().click();
    await page.waitForTimeout(6000);

    if (/connexion|authentification/i.test(page.url())) {
      return {
        status: 'manual',
        message:
          "L'APEC refuse la connexion automatique. Termine-la depuis la reprise en main.",
      };
    }
    return { status: 'connected', message: 'Session APEC ouverte.' };
  } catch (error) {
    return { status: 'manual', message: `Connexion APEC : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Candidature.
 *
 * Le bouton « Postuler » n'apparaît qu'une fois la session ouverte : sans
 * elle, l'annonce ne montre rien à quoi se raccrocher. Certaines annonces
 * renvoient tout de même vers le site de l'employeur — on le signale.
 */
export async function apply(context, offer, options = {}) {
  const page = await context.newPage();

  /*
   * On écoute les réponses plutôt que de lire la page.
   *
   * Le blocage se voit à coup sûr ici : le service `webservices/offre` répond
   * 403 et renvoie une adresse `captcha-delivery.com`. Se fier au texte affiché
   * (« L'offre n'est plus disponible ») était fragile — la formulation change,
   * et l'application Angular met parfois plusieurs secondes à l'écrire, si bien
   * qu'on repartait sur un diagnostic faux (« la session est-elle ouverte ? »)
   * alors que la session était parfaitement valide.
   */
  let bloque = false;
  page.on('response', (reponse) => {
    if (reponse.status() === 403 && /webservices\/offre/.test(reponse.url())) bloque = true;
  });
  page.on('requestfinished', (requete) => {
    if (/captcha-delivery\.com/.test(requete.url())) bloque = true;
  });

  /*
   * Statut distinct de « manual » : ce n'est pas une candidature qui a échoué,
   * c'est une plateforme qui refuse le navigateur piloté. La campagne s'en sert
   * pour cesser d'y dépenser son quota — mesuré six fois sur six, à trente
   * secondes l'essai, c'est le poste de gaspillage le plus coûteux.
   */
  const refus = () => ({
    status: 'blocked',
    message:
      "L'APEC bloque l'accès au détail de ses offres depuis un navigateur piloté " +
      '(anti-bot DataDome) — la session, elle, est bien ouverte. Candidature à ' +
      'faire depuis la reprise en main ou ton navigateur.',
  });

  try {
    await page.goto(offer.sourceUrl, { waitUntil: 'commit', timeout: 45_000 });
    await dismissConsent(page);
    // Application Angular : le contenu arrive bien après le DOM. On attend la
    // page réelle plutôt qu'un délai arbitraire, qui la manquait une fois sur deux.
    await page
      .waitForFunction(() => document.body.innerText.length > 1200, undefined, { timeout: 25_000 })
      .catch(() => {});

    const externe = await externalApplyUrl(page, 'apec.fr');
    if (externe) {
      return {
        status: 'external',
        message: `L'employeur reçoit les candidatures sur son propre site : `,
        externalUrl: externe,
      };
    }

    /*
     * L'APEC protège le détail de ses offres par un anti-bot.
     *
     * Vérifié en isolant les trois chemins possibles : URL directe, appel du
     * webservice depuis la page elle-même (mêmes cookies, même origine), et
     * parcours humain complet — recherche puis clic sur la carte. Les trois
     * échouent de la même façon : `webservices/offre/public` répond 403, et le
     * corps de la réponse renvoie vers `geo.captcha-delivery.com`, c'est-à-dire
     * DataDome. La session est pourtant bien ouverte, et la *recherche* passe :
     * seul le détail est filtré.
     *
     * Il n'y a donc rien à corriger côté sélecteurs, et rien à contourner : on
     * le dit clairement, et on oriente vers la reprise en main, où c'est un
     * humain qui candidate.
     */
    const texte = await page.innerText('body').catch(() => '');

    // Cas distinct du blocage : le site lui-même est indisponible. Le confondre
    // avec l'anti-bot enverrait chercher une session à rouvrir pour rien.
    if (/en maintenance|undergoing maintenance/i.test(texte)) {
      return {
        status: 'manual',
        message: "L'APEC est en maintenance : réessaie plus tard.",
      };
    }

    if (bloque || /n['’]est plus disponible|offre introuvable/i.test(texte)) return refus();

    const postuler = page.getByRole('button', { name: /postuler|candidater/i }).first();
    if (!(await postuler.count())) {
      // Le blocage peut n'être signalé qu'après coup : on redemande avant de
      // conclure à un problème de session, qui serait un diagnostic trompeur.
      if (bloque) return refus();
      return {
        status: 'manual',
        message:
          "Aucun bouton « Postuler » sur l'annonce : la session APEC est-elle bien ouverte ?",
      };
    }

    await postuler.click().catch(() => {});
    await page.waitForTimeout(3000);

    return await applyForm(page, options);
  } catch (error) {
    return { status: 'manual', message: `Candidature APEC : ${error.message}` };
  } finally {
    await page.close().catch(() => {});
  }
}
