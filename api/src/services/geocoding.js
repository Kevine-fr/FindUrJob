/**
 * Adresse en texte → coordonnées, via Nominatim (OpenStreetMap).
 *
 * Aucune plateforme d'emploi ne fournit de latitude : on n'a que « Paris 6e -
 * 75 » ou « Neuilly-sur-Seine ». Nominatim sait résoudre ça, mais son usage est
 * encadré — une requête par seconde, et un `User-Agent` identifiant
 * l'application, faute de quoi l'adresse IP est bloquée.
 *
 * D'où les deux protections ci-dessous : une file qui espace les appels, et un
 * cache qui évite de redemander cent fois « Paris » parce que cent offres y
 * sont situées. Les coordonnées trouvées sont ensuite écrites sur l'offre, si
 * bien qu'un même lieu n'est géocodé qu'une fois dans la vie de la base.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Un lieu résolu reste valable : les villes ne bougent pas. Le cache vit le
// temps du processus, la persistance étant assurée par l'offre elle-même.
const cache = new Map();

/**
 * Mentions qui ne désignent aucun lieu.
 *
 * Les envoyer à Nominatim consommerait le quota pour rien et renverrait parfois
 * un résultat absurde — « Remote » existe en Oregon.
 */
const NON_LIEUX =
  /^(t[ée]l[ée]travail|remote|full.?remote|france enti[èe]re|toute la france|non pr[ée]cis[ée]|à distance|anywhere|worldwide)$/i;

/**
 * Nettoie une adresse de plateforme avant de l'interroger.
 *
 * Les intitulés portent des scories qui font échouer la recherche : un code
 * département collé (« Paris 6e - 75 »), un arrondissement, une mention de
 * télétravail accolée à la ville.
 */
export function normaliserLieu(brut) {
  let lieu = String(brut || '')
    .replace(/\((.*?)\)/g, ' ') // « Lyon (69) »
    .replace(/\b\d{5}\b/g, ' ') // code postal collé
    .replace(/\s*-\s*\d{1,3}\s*$/, ' ') // « Paris 6e - 75 »
    .replace(/\b\d{1,2}(er|e|ème|eme)\b/gi, ' ') // arrondissement
    .replace(/\b(t[ée]l[ée]travail|hybride|sur site|partiel)\b/gi, ' ')
    .replace(/[;/|]/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, '');

  // Plusieurs villes séparées par une virgule : on garde la première, qui est
  // le lieu principal dans la quasi-totalité des annonces.
  if (lieu.includes(',')) lieu = lieu.split(',')[0].trim();

  return lieu;
}

let dernierAppel = 0;

/** Espace les appels d'au moins une seconde, comme l'exige Nominatim. */
async function attendreLeTour() {
  const ecoule = Date.now() - dernierAppel;
  if (ecoule < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - ecoule));
  }
  dernierAppel = Date.now();
}

/**
 * Résout une adresse. Rend `null` quand le lieu est introuvable ou n'en est
 * pas un — l'appelant note alors la tentative pour ne pas la refaire.
 */
export async function geocode(brut) {
  const lieu = normaliserLieu(brut);
  if (!lieu || lieu.length < 2 || NON_LIEUX.test(lieu)) return null;

  const cle = lieu.toLowerCase();
  if (cache.has(cle)) return cache.get(cle);

  await attendreLeTour();

  try {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(lieu)}`;
    const res = await fetch(url, {
      headers: {
        // Exigé par la politique d'usage : une requête anonyme est refusée.
        'User-Agent': 'FindUrJob/1.0 (copilote de candidature)',
        'Accept-Language': 'fr',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // 429 ou 403 : on n'insiste pas, la prochaine passe réessaiera.
      console.warn(`géocodage « ${lieu} » : HTTP ${res.status}`);
      return null;
    }

    const [premier] = await res.json();
    const point = premier
      ? { lat: Number(premier.lat), lon: Number(premier.lon) }
      : null;

    // On met aussi les échecs en cache : redemander « France entière » à chaque
    // offre coûterait une seconde par offre, pour le même résultat vide.
    cache.set(cle, point);
    return point;
  } catch (error) {
    console.warn(`géocodage « ${lieu} » impossible :`, error.message);
    return null;
  }
}
