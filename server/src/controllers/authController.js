import User from '../models/User.js';
import { asyncHandler } from '../middleware.js';
import { issue, verify, COOKIE_NAME, cookieOptions, isConfigured } from '../utils/session.js';
import { adoptOrphans } from '../utils/adoptOrphans.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;

const refuser = (res, code, message) => res.status(code).json({ error: message });

/** POST /auth/register — crée un compte et ouvre la session dans la foulée. */
export const register = asyncHandler(async (req, res) => {
  const { email, password, fullName } = req.body || {};

  if (!EMAIL.test(String(email || ''))) return refuser(res, 400, 'Adresse e-mail invalide.');
  if (String(password || '').length < MIN_PASSWORD) {
    return refuser(res, 400, `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
  }
  if (!isConfigured()) {
    return refuser(
      res,
      503,
      "Aucun secret de session configuré : impossible d'ouvrir un compte. " +
        'Définis SESSION_SECRET côté serveur.'
    );
  }

  if (await User.exists({ email: String(email).toLowerCase().trim() })) {
    // Message identique à une adresse libre serait plus discret, mais sur un
    // formulaire d'inscription l'utilisateur a besoin de savoir pourquoi ça bloque.
    return refuser(res, 409, 'Un compte existe déjà avec cette adresse.');
  }

  const user = await User.register({ email, password, fullName });

  /*
   * Le tout premier administrateur hérite des données d'avant
   * l'authentification.
   *
   * L'adoption tourne aussi au démarrage, mais sur une installation existante
   * personne n'a encore de compte à ce moment-là : sans ce rattrapage, le profil
   * et les offres déjà en base resteraient orphelins et invisibles.
   */
  if (user.role === 'admin') {
    await adoptOrphans().catch((error) => console.error('adoption :', error.message));
  }

  res.cookie(COOKIE_NAME, issue(user), cookieOptions());
  res.status(201).json({ user: user.toPublic() });
});

/** POST /auth/login */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  const user = await User.findOne({ email: String(email || '').toLowerCase().trim() }).select(
    '+passwordHash'
  );

  // Même réponse pour « compte inconnu » et « mot de passe faux » : distinguer
  // les deux permettrait d'énumérer les adresses inscrites.
  const ok = user && (await user.checkPassword(String(password || '')));
  if (!ok) return refuser(res, 401, 'Adresse ou mot de passe incorrect.');

  if (!user.active) return refuser(res, 403, 'Ce compte est désactivé.');

  user.lastLoginAt = new Date();
  user.loginCount += 1;
  await user.save();

  res.cookie(COOKIE_NAME, issue(user), cookieOptions());
  res.json({ user: user.toPublic() });
});

/** POST /auth/logout */
export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

/**
 * GET /auth/me — qui est connecté.
 *
 * Répond 200 avec `user: null` plutôt que 401 : c'est la question que pose le
 * front au démarrage, et « personne » est une réponse valide, pas une erreur.
 */
export const me = asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.json({ user: null, setupNeeded: (await User.estimatedDocumentCount()) === 0 });

  try {
    const { sub } = verify(token);
    const user = await User.findById(sub);
    if (!user || !user.active) return res.json({ user: null });
    return res.json({ user: user.toPublic() });
  } catch {
    return res.json({ user: null });
  }
});

/** PATCH /auth/me — nom et mot de passe du compte connecté. */
export const updateMe = asyncHandler(async (req, res) => {
  const { fullName, password, currentPassword } = req.body || {};
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return refuser(res, 404, 'Compte introuvable.');

  if (typeof fullName === 'string') user.fullName = fullName.trim();

  if (password) {
    // Changer de mot de passe exige de connaître l'actuel : sans cela, une
    // session volée suffirait à verrouiller le compte de son propriétaire.
    if (!(await user.checkPassword(String(currentPassword || '')))) {
      return refuser(res, 403, 'Mot de passe actuel incorrect.');
    }
    if (String(password).length < MIN_PASSWORD) {
      return refuser(res, 400, `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
    }
    await user.setPassword(password);
  }

  await user.save();
  res.json({ user: user.toPublic() });
});
