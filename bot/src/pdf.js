import { getRenderBrowser } from './browser.js';

/**
 * HTML → PDF A4, en une page.
 *
 * Le document sait se mettre à sa taille tout seul : il embarque son propre
 * script d'ajustement et publie le résultat dans `window.__cvFit`. Ici, on se
 * contente de l'attendre, puis d'imprimer. La mesure se fait donc avec les
 * polices *du conteneur*, pas celles du navigateur de l'utilisateur — c'est la
 * seule façon d'obtenir un PDF réellement sur une page.
 */

const A4 = { width: '210mm', height: '297mm' };

// Un document de CV est autonome (styles et images en data URI). Toute requête
// sortante est donc soit inutile, soit une fuite : on coupe le réseau.
const OFFLINE_ROUTE = (route) => {
  const url = route.request().url();
  if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) {
    return route.continue();
  }
  return route.abort();
};

export async function renderPdf(html, { timeout = 20_000 } = {}) {
  const browser = await getRenderBrowser();
  const context = await browser.newContext({
    viewport: { width: 1240, height: 1754 }, // A4 à ~150 dpi
    deviceScaleFactor: 2,
  });

  try {
    const page = await context.newPage();
    await page.route('**/*', OFFLINE_ROUTE);
    await page.setContent(html, { waitUntil: 'load', timeout });

    // L'ajustement est synchrone, mais les polices peuvent arriver après : on
    // attend le signal du document plutôt qu'un délai arbitraire.
    let fit = { density: 1, trimmed: 0, overflow: false, fill: 0 };
    try {
      await page.waitForFunction(() => window.__cvFit !== undefined, null, { timeout: 5_000 });
      fit = await page.evaluate(() => window.__cvFit);
    } catch {
      // Document sans script d'ajustement : on imprime tel quel.
    }

    const buffer = await page.pdf({
      ...A4,
      printBackground: true,
      preferCSSPageSize: true,
      // Le contenu tient : on borne à une page pour couper court aux pages
      // blanches que Chromium ajoute pour un dépassement d'un demi-pixel.
      ...(fit.overflow ? {} : { pageRanges: '1' }),
    });

    return { buffer, fit };
  } finally {
    await context.close().catch(() => {});
  }
}
