import express from 'express';
import morgan from 'morgan';

import { renderPdf } from './pdf.js';
import { getContext, closeContext, forgetContext, knownProfiles } from './browser.js';
import { getPlatform, PLATFORM_NAMES } from './platforms/index.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp() {
  const app = express();

  app.use(morgan('tiny'));
  // Un document de CV avec une photo en data URI pèse vite quelques mégaoctets.
  app.use(express.json({ limit: '12mb' }));

  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      service: 'findurjob-bot',
      platforms: PLATFORM_NAMES,
      sessions: await knownProfiles(),
      // Sans écran virtuel, la reprise en main n'est pas proposée côté interface.
      manualLogin: Boolean(process.env.DISPLAY),
      time: new Date().toISOString(),
    });
  });

  /**
   * POST /pdf — { html } → application/pdf
   *
   * Le résultat de l'ajustement part dans les en-têtes : le corps est le PDF,
   * et l'appelant a quand même besoin de savoir si le CV a dû être compacté.
   */
  app.post(
    '/pdf',
    asyncHandler(async (req, res) => {
      const { html } = req.body || {};
      if (typeof html !== 'string' || !html.trim()) {
        return res.status(400).json({ error: 'Champ `html` manquant.' });
      }

      const { buffer, fit } = await renderPdf(html);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(buffer.length),
        'X-Cv-Density': String(fit.density),
        'X-Cv-Trimmed': String(fit.trimmed),
        'X-Cv-Overflow': String(fit.overflow),
        'X-Cv-Fill': String(fit.fill),
      });
      res.end(buffer);
    })
  );

  /** GET /sessions — état de connexion de chaque plateforme. */
  app.get(
    '/sessions',
    asyncHandler(async (_req, res) => {
      const known = await knownProfiles();

      // Séquentiel, et non `Promise.all` : chaque vérification ouvre un
      // Chromium complet. Les lancer tous d'un coup fait un pic mémoire de
      // plusieurs centaines de mégaoctets à chaque affichage de la page.
      const sessions = [];
      for (const name of PLATFORM_NAMES) {
        if (!known.includes(name)) {
          sessions.push({ platform: name, state: 'absente' });
          continue;
        }
        try {
          const platform = getPlatform(name);
          const context = await getContext(name);
          sessions.push({
            platform: name,
            state: (await platform.isLoggedIn(context)) ? 'connectee' : 'expiree',
          });
        } catch (error) {
          sessions.push({ platform: name, state: 'erreur', message: error.message });
        }
      }
      res.json({ sessions });
    })
  );

  /**
   * POST /login — { platform, email, password }
   *
   * Le mot de passe transite en clair sur le réseau interne Docker, le temps de
   * la frappe dans le formulaire, et n'est écrit nulle part ici : le bot ne
   * garde que les cookies. Le chiffrement au repos est du ressort du serveur.
   */
  app.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { platform: platformName, email, password } = req.body || {};
      const platform = getPlatform(platformName);

      if (!email || !password) {
        return res.status(400).json({ error: 'Identifiants incomplets.' });
      }

      const context = await getContext(platformName);
      if (await platform.isLoggedIn(context)) {
        return res.json({ status: 'connected', message: 'Session déjà ouverte.' });
      }

      res.json(await platform.login(context, { email, password }));
    })
  );

  /**
   * POST /manual — { platform }
   *
   * Ouvre la page de connexion de la plateforme sur l'écran virtuel et rend la
   * main : c'est l'utilisateur qui termine, à la souris, via noVNC. On ne
   * cherche rien à automatiser ici — c'est précisément le point.
   */
  app.post(
    '/manual',
    asyncHandler(async (req, res) => {
      const { platform: platformName } = req.body || {};
      const platform = getPlatform(platformName);

      if (!process.env.DISPLAY) {
        return res.status(503).json({
          error:
            "Aucun écran virtuel dans ce conteneur : la reprise en main n'est pas " +
            'disponible. Reconstruis l\'image du service `bot`.',
        });
      }

      const context = await getContext(platformName);
      const page = context.pages()[0] || (await context.newPage());
      await page.bringToFront();
      await page.goto(platform.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

      res.json({
        status: 'ouvert',
        platform: platformName,
        loginUrl: platform.loginUrl,
        message: 'Page de connexion ouverte. Termine la connexion dans la fenêtre.',
      });
    })
  );

  /**
   * GET /manual/:platform — la session est-elle ouverte ?
   * Appelé quand l'utilisateur déclare avoir terminé : c'est la plateforme qui
   * tranche, pas lui.
   */
  app.get(
    '/manual/:platform',
    asyncHandler(async (req, res) => {
      const platform = getPlatform(req.params.platform);
      const context = await getContext(req.params.platform);
      const connected = await platform.isLoggedIn(context);
      res.json({ platform: req.params.platform, connected });
    })
  );

  /** POST /search — { platform, keywords, location, contractTypes, remotes, limit } */
  app.post(
    '/search',
    asyncHandler(async (req, res) => {
      const { platform: platformName, ...query } = req.body || {};
      const platform = getPlatform(platformName);

      const context = await getContext(platformName);
      const offers = await platform.search(context, query);
      res.json({ offers, total: offers.length, platform: platformName });
    })
  );

  /** POST /apply — { platform, offer, cvPath } */
  app.post(
    '/apply',
    asyncHandler(async (req, res) => {
      const { platform: platformName, offer, cvPath } = req.body || {};
      const platform = getPlatform(platformName);

      if (!offer?.sourceUrl) {
        return res.status(400).json({ error: "L'offre n'a pas d'URL : impossible de candidater." });
      }

      const context = await getContext(platformName);
      if (!(await platform.isLoggedIn(context))) {
        return res.status(409).json({
          error: `Aucune session ${platformName} ouverte. Connecte-toi depuis l'onglet Comptes.`,
        });
      }

      res.json(await platform.apply(context, offer, { cvPath }));
    })
  );

  /** DELETE /sessions/:platform — ?purge=1 efface aussi les cookies du disque. */
  app.delete(
    '/sessions/:platform',
    asyncHandler(async (req, res) => {
      getPlatform(req.params.platform);
      if (req.query.purge === '1') await forgetContext(req.params.platform);
      else await closeContext(req.params.platform);
      res.status(204).end();
    })
  );

  app.use((_req, res) => res.status(404).json({ error: 'Route inconnue' }));

  // eslint-disable-next-line no-unused-vars -- Express reconnaît le gestionnaire d'erreurs à ses 4 arguments
  app.use((err, _req, res, _next) => {
    console.error('bot:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur du navigateur piloté' });
  });

  return app;
}
