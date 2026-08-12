import PlatformAccount from '../models/PlatformAccount.js';
import { asyncHandler } from '../middleware.js';
import { seal, open, isConfigured } from '../utils/vault.js';
import {
  botSessions,
  botLogin,
  botForget,
  botConfigured,
  botManualOpen,
  botManualStatus,
  botHealth,
  botVncUrl,
} from '../services/botService.js';
import { BOT_PLATFORMS } from '../utils/constants.js';

const assertPlatform = (platform) => {
  if (!BOT_PLATFORMS.includes(platform)) {
    const err = new Error(`Plateforme inconnue : « ${platform} ».`);
    err.status = 400;
    throw err;
  }
};

/**
 * GET /accounts — un compte par plateforme pilotable, même sans identifiants.
 *
 * L'état de session vient du bot, qui seul sait si les cookies valent encore
 * quelque chose. S'il ne répond pas, on rend l'état connu en base : la page
 * reste lisible quand le bot est arrêté.
 */
export const listAccounts = asyncHandler(async (_req, res) => {
  const stored = await PlatformAccount.find();
  const byPlatform = new Map(stored.map((account) => [account.platform, account]));

  let live = new Map();
  let botError = null;
  if (botConfigured()) {
    try {
      const { sessions } = await botSessions();
      live = new Map(sessions.map((session) => [session.platform, session]));
    } catch (error) {
      botError = error.message;
    }
  }

  const accounts = await Promise.all(
    BOT_PLATFORMS.map(async (platform) => {
      const account = byPlatform.get(platform) || new PlatformAccount({ platform });
      const session = live.get(platform);

      if (session && session.state !== account.sessionState) {
        account.sessionState = session.state;
        account.lastCheckedAt = new Date();
        if (account.isNew) await account.save();
        else await account.updateOne({ sessionState: session.state, lastCheckedAt: new Date() });
      }
      return account.toPublic();
    })
  );

  // La reprise en main n'a de sens que si le conteneur a un écran virtuel.
  let manualLogin = false;
  if (botConfigured() && !botError) {
    manualLogin = await botHealth()
      .then((health) => Boolean(health.manualLogin))
      .catch(() => false);
  }

  res.json({
    accounts,
    vaultReady: isConfigured(),
    botReady: botConfigured(),
    botError,
    manualLogin,
    vncUrl: botVncUrl(),
  });
});

/**
 * POST /accounts/:platform/manual — ouvre la page de connexion sur l'écran du
 * navigateur piloté, pour que l'utilisateur termine lui-même.
 *
 * C'est la porte de sortie quand la connexion automatique bute : plutôt que de
 * s'acharner sur une 2FA ou un captcha, on rend la main.
 */
export const openManualLogin = asyncHandler(async (req, res) => {
  const { platform } = req.params;
  assertPlatform(platform);

  const result = await botManualOpen(platform);
  await PlatformAccount.updateOne(
    { platform },
    { sessionState: 'verification', lastMessage: 'Connexion manuelle en cours.' },
    { upsert: true }
  );

  res.json({ ...result, vncUrl: botVncUrl() });
});

/**
 * GET /accounts/:platform/manual — vérifie que la session est bien ouverte.
 * C'est la plateforme qui tranche, pas la déclaration de l'utilisateur.
 */
export const checkManualLogin = asyncHandler(async (req, res) => {
  const { platform } = req.params;
  assertPlatform(platform);

  const { connected } = await botManualStatus(platform);
  const account =
    (await PlatformAccount.findOne({ platform })) || new PlatformAccount({ platform });

  account.sessionState = connected ? 'connectee' : 'expiree';
  account.lastCheckedAt = new Date();
  account.lastMessage = connected
    ? 'Session ouverte manuellement.'
    : "La plateforme ne reconnaît pas encore de session : la connexion n'est pas terminée.";
  if (connected) account.lastLoginAt = new Date();
  await account.save();

  res.json({ connected, account: account.toPublic() });
});

/**
 * PUT /accounts/:platform — enregistre e-mail et mot de passe.
 *
 * Le mot de passe est chiffré avant d'atteindre la base et n'est jamais relu
 * par une route de lecture. Un corps sans `password` met à jour le reste sans
 * effacer celui déjà enregistré.
 */
export const saveAccount = asyncHandler(async (req, res) => {
  const { platform } = req.params;
  assertPlatform(platform);

  const { email, password, dailyQuota } = req.body || {};
  const account =
    (await PlatformAccount.findOne({ platform })) || new PlatformAccount({ platform });

  if (typeof email === 'string') account.email = email.trim();
  if (Number.isFinite(Number(dailyQuota))) {
    account.dailyQuota = Math.max(1, Math.min(50, Number(dailyQuota)));
  }

  if (password) {
    account.password = seal(password); // lève une VaultError si aucune clé n'est configurée
    account.hasPassword = true;
  }

  await account.save();
  res.json(account.toPublic());
});

/** DELETE /accounts/:platform — oublie les identifiants et ferme la session. */
export const deleteAccount = asyncHandler(async (req, res) => {
  const { platform } = req.params;
  assertPlatform(platform);

  await PlatformAccount.deleteOne({ platform });
  if (botConfigured()) await botForget(platform, true).catch(() => {});

  res.status(204).end();
});

/**
 * POST /accounts/:platform/login — ouvre la session sur la plateforme.
 *
 * Le mot de passe n'est déchiffré qu'ici, le temps de l'appel au bot. Si la
 * plateforme demande une vérification (2FA, captcha), on remonte la capture
 * d'écran : c'est à l'utilisateur de la franchir, pas au robot.
 */
export const loginAccount = asyncHandler(async (req, res) => {
  const { platform } = req.params;
  assertPlatform(platform);

  const account = await PlatformAccount.findOne({ platform }).select('+password');
  if (!account?.email) {
    return res.status(400).json({ error: 'Renseigne d\'abord un e-mail pour cette plateforme.' });
  }

  // Un mot de passe fourni à la volée évite d'avoir à l'enregistrer.
  const password = req.body?.password || (account.password ? open(account.password) : '');
  if (!password) {
    return res.status(400).json({ error: 'Aucun mot de passe enregistré pour cette plateforme.' });
  }

  const result = await botLogin(platform, account.email, password);

  const STATE = { connected: 'connectee', verification: 'verification', failed: 'erreur' };
  account.sessionState = STATE[result.status] || 'erreur';
  account.lastMessage = result.message || '';
  account.lastCheckedAt = new Date();
  if (result.status === 'connected') account.lastLoginAt = new Date();
  await account.save();

  res.json({ ...result, account: account.toPublic() });
});

/** POST /accounts/:platform/logout — ferme la session, garde les identifiants. */
export const logoutAccount = asyncHandler(async (req, res) => {
  const { platform } = req.params;
  assertPlatform(platform);

  if (botConfigured()) await botForget(platform, true);
  await PlatformAccount.updateOne(
    { platform },
    { sessionState: 'absente', lastMessage: 'Session fermée.', lastCheckedAt: new Date() }
  );
  res.status(204).end();
});
