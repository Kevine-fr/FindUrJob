import express from 'express';
import morgan from 'morgan';

import { renderPdf } from './pdf.js';
import { getContext, closeContext, forgetContext, knownProfiles, pageVivante } from './browser.js';
import { getPlatform, PLATFORM_NAMES } from './platforms/index.js';
import { raisonTechnique } from './platforms/failures.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Une session Google est-elle ouverte dans ce profil ?
 *
 * Google renvoie vers `accounts.google.com` quand on n'est pas connecté :
 * rester sur `myaccount.google.com` est donc le signe d'une session valide.
 */
async function isGoogleLoggedIn(context) {
  const page = await context.newPage();
  try {
    await page.goto('https://myaccount.google.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    return !/accounts\.google\.com|\/ServiceLogin|\/signin/.test(page.url());
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

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
      sessions: [],
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
    asyncHandler(async (req, res) => {
      const known = await knownProfiles(req.query.user);

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
          const context = await getContext(name, { user: req.query.user });
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
      const { platform: platformName, user, email, password } = req.body || {};
      const platform = getPlatform(platformName);

      if (!email || !password) {
        return res.status(400).json({ error: 'Identifiants incomplets.' });
      }

      const context = await getContext(platformName, { user });
      if (await platform.isLoggedIn(context)) {
        return res.json({ status: 'connected', message: 'Session déjà ouverte.' });
      }

      res.json(await platform.login(context, { email, password }));
    })
  );

  /**
   * POST /manual — { platform, target }
   *
   * Ouvre une page sur l'écran virtuel et rend la main : c'est l'utilisateur
   * qui termine, à la souris, via noVNC. On ne cherche rien à automatiser ici —
   * c'est précisément le point.
   *
   * `target` choisit quoi ouvrir, **toujours dans le navigateur de la
   * plateforme visée** :
   *   - `plateforme` : sa page de connexion ;
   *   - `google`     : la connexion Google, pour que « Se connecter avec
   *                    Google » fonctionne ensuite sur cette plateforme ;
   *   - `gmail`      : la boîte de réception, pour relever un code de
   *                    vérification sans quitter la fenêtre.
   *
   * Une session Google ouverte dans un autre profil ne servirait à rien : les
   * cookies sont cloisonnés par profil, et c'est celui de la plateforme qui
   * compte au moment du « Se connecter avec Google ».
   */
  app.post(
    '/manual',
    asyncHandler(async (req, res) => {
      const { platform: platformName, user, target = 'plateforme' } = req.body || {};
      const platform = getPlatform(platformName);

      if (!process.env.DISPLAY) {
        return res.status(503).json({
          error:
            "Aucun écran virtuel dans ce conteneur : la reprise en main n'est pas " +
            "disponible. Reconstruis l'image du service `bot`.",
        });
      }

      // Liste blanche : l'URL ne vient jamais de l'appelant.
      const destinations = {
        plateforme: platform.loginUrl,
        google: 'https://accounts.google.com/ServiceLogin',
        gmail: 'https://mail.google.com/',
      };
      const url = destinations[target];
      if (!url) {
        return res.status(400).json({
          error: `Destination inconnue : « ${target} ». Attendu : ${Object.keys(destinations).join(', ')}.`,
        });
      }

      const context = await getContext(platformName, { user });
      // Un onglet par destination : garder la plateforme et Gmail ouverts côte
      // à côte est tout l'intérêt quand on attend un code de vérification.
      const page =
        target === 'plateforme' ? await pageVivante(platformName, user) : await context.newPage();

      /*
       * Mettre l'onglet au premier plan est un confort, pas une condition.
       *
       * Sur un onglet planté, `bringToFront` lève « Target crashed » — et comme
       * l'erreur remontait, la connexion manuelle devenait impossible sur
       * toutes les plateformes restantes. Or c'est le seul écran depuis lequel
       * on peut rouvrir une session : la panne se refermait sur elle-même.
       *
       * `pageVivante` garantit désormais un onglet sain ; ce filet ne couvre
       * plus que le cas où l'écran virtuel refuse le focus, qui n'empêche rien.
       */
      await page.bringToFront().catch(() => {});
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

      res.json({
        status: 'ouvert',
        platform: platformName,
        target,
        url,
        message: 'Page ouverte dans le navigateur du robot.',
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
      const context = await getContext(req.params.platform, { user: req.query.user });
      const connected = await platform.isLoggedIn(context);
      res.json({
        platform: req.params.platform,
        connected,
        // Une session Google déjà ouverte dans ce profil rend le bouton
        // « Se connecter avec Google » de la plateforme utilisable en un clic.
        google: await isGoogleLoggedIn(context),
      });
    })
  );

  /** POST /search — { platform, keywords, location, contractTypes, remotes, limit } */
  app.post(
    '/search',
    asyncHandler(async (req, res) => {
      const { platform: platformName, user, ...query } = req.body || {};
      const platform = getPlatform(platformName);

      const context = await getContext(platformName, { user });
      const offers = await platform.search(context, query);
      res.json({ offers, total: offers.length, platform: platformName });
    })
  );

  /**
   * POST /apply — { platform, offer, cv }
   *
   * `cv` : { filename, content } — le PDF en base64. Il arrive dans la requête
   * plutôt que par un chemin de fichier : le serveur et le bot ne partagent
   * aucun disque, et Playwright sait téléverser depuis un tampon mémoire.
   */
  /**
   * GET /candidatures — ce que la plateforme dit avoir reçu.
   *
   * C'est la contrepartie indispensable de `/apply` : une confirmation ne
   * s'affiche pas toujours au moment de l'envoi, et s'y fier seul faisait
   * classer en « à vérifier » des candidatures pourtant bien arrivées. Ici,
   * c'est la plateforme qui répond.
   *
   * Toutes ne tiennent pas une telle liste : celles-là le disent plutôt que de
   * rendre un tableau vide, qu'on prendrait pour « rien n'est arrivé ».
   */
  app.get(
    '/candidatures',
    asyncHandler(async (req, res) => {
      const platform = getPlatform(req.query.platform);

      if (typeof platform.listApplications !== 'function') {
        return res.status(501).json({
          error: `${req.query.platform} n'expose pas de liste « mes candidatures » exploitable.`,
        });
      }

      const context = await getContext(req.query.platform, { user: req.query.user });
      if (!(await platform.isLoggedIn(context))) {
        return res.status(409).json({ error: `Aucune session ${req.query.platform} ouverte.` });
      }

      const max = Math.min(Math.max(1, Number(req.query.max) || 120), 400);
      res.json({ applications: await platform.listApplications(context, { max }) });
    })
  );

  app.post(
    '/apply',
    asyncHandler(async (req, res) => {
      const {
        platform: platformName,
        user,
        offer,
        cv,
        applicant,
        coverLetter,
        dryRun,
        // Réponses déjà données aux questions des plateformes, indexées par
        // libellé normalisé. Ce qui évite de rebuter sur la même question.
        answers,
      } = req.body || {};
      const platform = getPlatform(platformName);

      if (!offer?.sourceUrl) {
        return res.status(400).json({ error: "L'offre n'a pas d'URL : impossible de candidater." });
      }

      const context = await getContext(platformName, { user });
      if (!(await platform.isLoggedIn(context))) {
        return res.status(409).json({
          error: `Aucune session ${platformName} ouverte. Connecte-toi depuis l'onglet Comptes.`,
        });
      }

      const fichier = cv?.content
        ? {
            name: cv.filename || 'CV.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(cv.content, 'base64'),
          }
        : null;

      const resultat = await platform.apply(context, offer, {
        cvFile: fichier,
        applicant,
        coverLetter,
        dryRun,
        answers: answers || {},
      });

      /*
       * Session découverte fermée **pendant** la candidature.
       *
       * Le contrôle d'avant l'envoi peut se tromper : celui de France Travail
       * est borné dans le temps et conclut « ouverte » quand il n'aboutit pas,
       * pour ne pas rester bloqué. La vérité se découvre alors sur la page —
       * un bouton « Se connecter » là où devrait être « Envoyer ma
       * candidature ».
       *
       * On répond 409, le même code que le contrôle préalable : l'API sait
       * déjà le traiter, elle rouvre la session et réessaie une fois. Rendre
       * un échec ordinaire aurait laissé la candidature morte alors qu'il
       * suffisait de se reconnecter — c'est exactement ce qui empêchait France
       * Travail d'aboutir.
       */
      if (resultat?.status === 'session') {
        return res.status(409).json({ error: resultat.message, reason: resultat.reason });
      }

      res.json(resultat);
    })
  );

  /** DELETE /sessions/:platform — ?purge=1 efface aussi les cookies du disque. */
  app.delete(
    '/sessions/:platform',
    asyncHandler(async (req, res) => {
      getPlatform(req.params.platform);
      if (req.query.purge === '1') await forgetContext(req.params.platform, req.query.user);
      else await closeContext(req.params.platform, req.query.user);
      res.status(204).end();
    })
  );

  app.use((_req, res) => res.status(404).json({ error: 'Route inconnue' }));

  // eslint-disable-next-line no-unused-vars -- Express reconnaît le gestionnaire d'erreurs à ses 4 arguments
  app.use((err, _req, res, _next) => {
    console.error('bot:', err);
    /*
     * Le code accompagne le message, même ici.
     *
     * Les plateformes sans `catch` propre laissent remonter l'exception brute
     * jusqu'ici : « locator.count: Target crashed » arrivait alors côté API
     * sans rien pour le classer, et la candidature repartait en « cause non
     * identifiée ». Le robot sait, lui, de quoi il s'agit — autant le dire.
     */
    res.status(err.status || 500).json({
      error: err.message || 'Erreur du navigateur piloté',
      reason: raisonTechnique(err),
    });
  });

  return app;
}
