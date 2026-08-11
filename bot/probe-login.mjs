import { getContext } from './src/browser.js';

const context = await getContext('hellowork');
const page = await context.newPage();

const response = await page.goto('https://www.hellowork.com/fr-fr/connexion.html', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await page.waitForTimeout(3500);

const info = await page.evaluate(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  return {
    url: location.href,
    title: document.title.slice(0, 80),
    // Tous les champs de saisie de la page, visibles ou non.
    inputs: [...document.querySelectorAll('input')].map((el) => ({
      type: el.type,
      name: el.name || null,
      id: el.id || null,
      placeholder: el.placeholder || null,
      autocomplete: el.getAttribute('autocomplete'),
      visible: visible(el),
    })),
    buttons: [...document.querySelectorAll('button, input[type="submit"]')]
      .filter(visible)
      .slice(0, 10)
      .map((el) => ({
        text: (el.innerText || el.value || '').trim().slice(0, 40),
        id: el.id || null,
        type: el.type || null,
      })),
    // Une bannière de consentement recouvre le formulaire et bloque fill().
    consentSuspects: [...document.querySelectorAll('[id*="consent" i],[class*="consent" i],[id*="cookie" i],[class*="cookie" i],[id*="didomi" i],[class*="didomi" i],[id*="tarteaucitron" i]')]
      .filter(visible)
      .slice(0, 6)
      .map((el) => `${el.tagName}#${el.id || ''}.${(el.className || '').toString().slice(0, 40)}`),
    iframes: [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 70) || '(sans src)'),
  };
});

console.log(`HTTP ${response?.status()}`);
console.log(JSON.stringify(info, null, 1));

await page.screenshot({ path: '/tmp/hw-login.png' });
await page.close();
process.exit(0);
