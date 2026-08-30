import User from '../models/User.js';
import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import CVVersion from '../models/CVVersion.js';
import Profile from '../models/Profile.js';
import Campaign from '../models/Campaign.js';
import SearchPreference from '../models/SearchPreference.js';
import PlatformAccount from '../models/PlatformAccount.js';
import { sendMail, verifyMail, resetMail, mailerConfigured } from '../services/mailer.js';
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

  /*
   * Le courriel de confirmation part à l’inscription, sans la bloquer.
   *
   * On n’attend pas la confirmation pour ouvrir la session : si le message
   * n’arrive jamais — SMTP absent, adresse en quarantaine —, la personne serait
   * enfermée dehors sans recours. Le compte fonctionne, la vérification est un
   * badge qu’on peut relancer depuis l’espace compte.
   */
  const secret = user.issueToken('verify', 24 * 60);
  await user.save();
  await sendMail(verifyMail(user, secret));

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

/* ---- Vérification de l'adresse ------------------------------------------ */

/**
 * POST /auth/verify/send — (re)envoie le courriel de confirmation.
 *
 * Volontairement silencieux sur l'existence du compte quand il est déjà
 * vérifié : la réponse est la même dans les deux cas.
 */
export const sendVerification = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+verifyTokenHash +verifyExpiresAt');
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });

  if (user.emailVerifiedAt) {
    return res.json({ alreadyVerified: true, sent: false });
  }

  const secret = user.issueToken('verify', 24 * 60);
  await user.save();

  const { sent } = await sendMail(verifyMail(user, secret));
  res.json({ sent, mailer: mailerConfigured() });
});

/** POST /auth/verify — confirme l'adresse à partir du jeton du courriel. */
export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await User.byToken('verify', req.body?.token);
  if (!user) {
    return res.status(400).json({ error: 'Lien de confirmation invalide ou expiré.' });
  }

  user.emailVerifiedAt = new Date();
  // Le jeton ne sert qu'une fois : on l'efface plutôt que d'attendre son
  // expiration, pour qu'un lien retrouvé dans une boîte mail ne rejoue rien.
  user.verifyTokenHash = '';
  user.verifyExpiresAt = null;
  await user.save();

  res.json({ verified: true, user: user.toPublic() });
});

/* ---- Mot de passe oublié ------------------------------------------------ */

/**
 * POST /auth/password/forgot — envoie un lien de réinitialisation.
 *
 * Répond toujours la même chose, que l'adresse existe ou non : distinguer les
 * deux cas transformerait cette route en outil d'énumération de comptes.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const reponse = { requested: true, mailer: mailerConfigured() };

  if (!email) return res.json(reponse);

  const user = await User.findOne({ email }).select('+resetTokenHash +resetExpiresAt');
  if (!user || !user.active) return res.json(reponse);

  const secret = user.issueToken('reset', 60);
  await user.save();

  await sendMail(resetMail(user, secret));
  res.json(reponse);
});

/** POST /auth/password/reset — pose le nouveau mot de passe. */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};

  if (!password || String(password).length < MIN_PASSWORD) {
    return res.status(400).json({
      error: `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`,
    });
  }

  const user = await User.byToken('reset', token);
  if (!user) {
    return res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
  }

  await user.setPassword(password);
  user.resetTokenHash = '';
  user.resetExpiresAt = null;
  await user.save();

  res.json({ reset: true });
});

/* ---- Gestion du compte -------------------------------------------------- */

/** POST /auth/password/change — depuis l'espace compte, mot de passe actuel exigé. */
export const changePassword = asyncHandler(async (req, res) => {
  const { current, password } = req.body || {};

  if (!password || String(password).length < MIN_PASSWORD) {
    return res.status(400).json({
      error: `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`,
    });
  }

  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });

  // Un compte créé via Google n'a pas de mot de passe : il en pose un sans avoir
  // à prouver l'ancien, puisqu'il n'y en a pas.
  const doitProuver = Boolean(user.passwordHash);
  if (doitProuver && !(await user.checkPassword(current || ''))) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  }

  await user.setPassword(password);
  await user.save();
  res.json({ changed: true });
});

/**
 * DELETE /auth/me — supprime le compte et tout ce qui lui appartient.
 *
 * Le mot de passe est réclamé : c'est irréversible, et une session volée ne doit
 * pas suffire à effacer des mois de candidatures. Les comptes Google, qui n'en
 * ont pas, confirment en retapant leur adresse.
 */
export const deleteMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });

  const { password, confirmEmail } = req.body || {};

  if (user.passwordHash) {
    if (!(await user.checkPassword(password || ''))) {
      return res.status(400).json({ error: 'Mot de passe incorrect : suppression annulée.' });
    }
  } else if (String(confirmEmail || '').trim().toLowerCase() !== user.email) {
    return res.status(400).json({ error: 'Retape ton adresse pour confirmer la suppression.' });
  }

  /*
   * On efface toutes les collections rattachées au compte.
   *
   * Rien n'est laissé derrière : les offres, candidatures et CV n'ont aucune
   * valeur détachés de leur propriétaire, et les garder ferait une base de
   * données de personnes qui ont demandé leur effacement.
   */
  const id = user._id;
  await Promise.all([
    Application.deleteMany({ user: id }),
    JobOffer.deleteMany({ user: id }),
    CVVersion.deleteMany({ user: id }),
    Profile.deleteMany({ user: id }),
    Campaign.deleteMany({ user: id }),
    SearchPreference.deleteMany({ user: id }),
    PlatformAccount.deleteMany({ user: id }),
  ]);
  await User.deleteOne({ _id: id });

  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ deleted: true });
});
