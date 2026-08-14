import { normalize, humanPause } from './common.js';

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

// L'APEC n'est pas pilotée pour candidater : l'annonce renvoie vers le
// formulaire de l'employeur. On le dit plutôt que d'échouer en silence.
export async function isLoggedIn() {
  return false;
}

export async function login() {
  return {
    status: 'manual',
    message:
      "La candidature APEC n'est pas automatisée : ouvre l'annonce et postule depuis le site.",
  };
}

export async function apply() {
  return {
    status: 'manual',
    message: "L'APEC renvoie vers le formulaire de l'employeur : candidature à faire à la main.",
  };
}
