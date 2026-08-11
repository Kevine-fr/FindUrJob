/**
 * Socle commun aux plateformes sans API.
 *
 * Les offres sorties d'ici ont exactement la forme attendue par
 * `server/src/controllers/offerController.js` (`sanitize`) — le vocabulaire est
 * le même que celui du moteur Python (`ai/app/sources/base.py`), pour qu'une
 * offre scrapée et une offre d'API soient indistinguables en base.
 */

export const stripAccents = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // les diacritiques, une fois détachés

const REMOTE_HINTS = ['teletravail', '100% remote', 'full remote', 'remote', 'a distance', 'distanciel'];
const HYBRID_HINTS = ['hybride', 'partiel', 'hybrid', '2 jours', '3 jours'];

export function guessRemote(...texts) {
  const blob = stripAccents(texts.filter(Boolean).join(' ')).toLowerCase();
  if (HYBRID_HINTS.some((hint) => blob.includes(hint))) return 'hybride';
  if (REMOTE_HINTS.some((hint) => blob.includes(hint))) return 'teletravail';
  return 'non_precise';
}

export function guessContract(...texts) {
  const blob = stripAccents(texts.filter(Boolean).join(' ')).toLowerCase().replace(/_/g, ' ');
  if (/alternance|apprentissage|apprentice/.test(blob)) return 'alternance';
  if (/stage|internship|stagiaire/.test(blob)) return 'stage';
  if (/freelance|independant|contractor|mission/.test(blob)) return 'freelance';
  if (/\bcdd\b|temporary|fixed[- ]term|interim|intérim/.test(blob)) return 'cdd';
  if (/\bcdi\b|permanent|full[- ]time|temps plein/.test(blob)) return 'cdi';
  return 'autre';
}

/** HTML → texte lisible. Les annonces arrivent presque toujours en HTML. */
export function cleanHtml(raw) {
  if (!raw) return '';
  let text = String(raw)
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '');

  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&ccedil;': 'ç',
  };
  for (const [entity, char] of Object.entries(entities)) text = text.split(entity).join(char);
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Ramène une offre à la forme du modèle `JobOffer`. */
export function normalize(offer, source) {
  const description = cleanHtml(offer.description || '');
  return {
    title: cleanHtml(offer.title || '').trim(),
    company: cleanHtml(offer.company || '').trim(),
    location: cleanHtml(offer.location || '').trim(),
    source,
    sourceUrl: String(offer.sourceUrl || '').trim(),
    externalId: String(offer.externalId || '').trim(),
    description,
    contractType:
      offer.contractType || guessContract(offer.contractHint, offer.title, description.slice(0, 400)),
    remote: offer.remote || guessRemote(offer.title, offer.location, description),
    salary: cleanHtml(offer.salary || '').trim(),
    keywords: (offer.keywords || []).filter((word) => typeof word === 'string').slice(0, 12),
  };
}

/**
 * Offres décrites en JSON-LD (schema.org/JobPosting).
 *
 * C'est la voie la plus stable : beaucoup de sites d'emploi publient ce bloc
 * pour Google, et il bouge bien moins souvent que leurs classes CSS. On l'essaie
 * avant de tomber sur les sélecteurs.
 */
export async function jsonLdJobs(page) {
  return page.evaluate(() => {
    const found = [];

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);

      const type = [].concat(node['@type'] || []);
      if (type.includes('JobPosting')) {
        const place = node.jobLocation?.address || node.jobLocation?.[0]?.address || {};
        found.push({
          title: node.title || '',
          company: node.hiringOrganization?.name || '',
          location: [place.addressLocality, place.addressRegion].filter(Boolean).join(', '),
          description: node.description || '',
          sourceUrl: node.url || location.href,
          externalId: String(node.identifier?.value || node.identifier || ''),
          contractHint: [].concat(node.employmentType || []).join(' '),
          salary: node.baseSalary?.value?.value
            ? String(node.baseSalary.value.value)
            : node.baseSalary?.value?.minValue
              ? `${node.baseSalary.value.minValue} – ${node.baseSalary.value.maxValue || ''}`
              : '',
        });
      }
      Object.values(node).forEach(visit);
    };

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(script.textContent));
      } catch {
        /* bloc malformé : on passe au suivant */
      }
    }
    return found;
  });
}

/** Le premier sélecteur qui donne du texte gagne. */
export const textFrom = (root, selectors) => {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const text = node?.getAttribute?.('title') || node?.textContent;
    if (text && text.trim()) return text.trim();
  }
  return '';
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cadence humaine entre deux actions.
 *
 * Ce n'est pas un contournement : c'est la contrepartie du choix assumé de
 * candidater en petit volume. Un enchaînement à pleine vitesse dégrade la
 * qualité des candidatures autant qu'il attire l'attention.
 */
export const humanPause = (min = 900, max = 2400) =>
  sleep(min + Math.floor(Math.random() * (max - min)));
