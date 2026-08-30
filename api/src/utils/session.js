import crypto from 'node:crypto';

/**
 * Jetons de session.
 *
 * Format : `<charge utile base64url>.<signature base64url>`, signé en HMAC-SHA256.
 * C'est un JWT sans les parties dont on n'a pas l'usage — pas de négociation
 * d'algorithme, donc pas de confusion d'algorithme possible.
 *
 * Le jeton voyage dans un cookie `httpOnly` : le JavaScript de la page ne peut
 * pas le lire, ce qui met une XSS hors d'état de voler la session.
 */

const ALGO = 'sha256';
const DUREE_PAR_DEFAUT = 30 * 24 * 3600; // 30 jours, en secondes

export class SessionError extends Error {
  constructor(message) {
    super(message);
    this.status = 401;
  }
}

/**
 * La clé de signature. On réutilise `CREDENTIALS_KEY` si `SESSION_SECRET` n'est
 * pas défini : une installation existante reste fonctionnelle sans nouvelle
 * variable, et les deux usages restent séparés par le préfixe ci-dessous.
 */
function secret() {
  const brut = (process.env.SESSION_SECRET || process.env.CREDENTIALS_KEY || '').trim();
  if (!brut) {
    throw new SessionError(
      "Aucun secret de session : définis SESSION_SECRET (ou CREDENTIALS_KEY). " +
        'En générer un : openssl rand -hex 32'
    );
  }
  // Dérivation : la clé de signature n'est jamais la clé de chiffrement du
  // coffre, même quand les deux partent de la même variable.
  return crypto.createHash(ALGO).update(`findurjob:session:${brut}`).digest();
}

export const isConfigured = () =>
  Boolean((process.env.SESSION_SECRET || process.env.CREDENTIALS_KEY || '').trim());

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

function sign(payload) {
  return b64(crypto.createHmac(ALGO, secret()).update(payload).digest());
}

/** Émet un jeton pour un utilisateur. */
export function issue(user, { expiresIn = DUREE_PAR_DEFAUT } = {}) {
  const charge = b64(
    JSON.stringify({
      sub: user._id.toString(),
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    })
  );
  return `${charge}.${sign(charge)}`;
}

/** Vérifie et décode un jeton. Lève une `SessionError` sur le moindre doute. */
export function verify(token) {
  const [charge, signature] = String(token || '').split('.');
  if (!charge || !signature) throw new SessionError('Session illisible.');

  const attendue = Buffer.from(sign(charge), 'utf8');
  const fournie = Buffer.from(signature, 'utf8');
  if (attendue.length !== fournie.length || !crypto.timingSafeEqual(attendue, fournie)) {
    throw new SessionError('Session invalide.');
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  } catch {
    throw new SessionError('Session illisible.');
  }

  if (!data.sub || typeof data.exp !== 'number') throw new SessionError('Session incomplète.');
  if (data.exp * 1000 < Date.now()) throw new SessionError('Session expirée.');

  return data;
}

export const COOKIE_NAME = 'findurjob_session';

/**
 * Options du cookie de session.
 * `sameSite: lax` laisse passer la navigation depuis un lien externe tout en
 * bloquant les requêtes croisées d'un formulaire tiers (CSRF).
 */
export function cookieOptions({ maxAge = DUREE_PAR_DEFAUT } = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // En production le site est en HTTPS ; en développement, `secure` empêcherait
    // le cookie d'être posé sur http://localhost.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAge * 1000,
  };
}
