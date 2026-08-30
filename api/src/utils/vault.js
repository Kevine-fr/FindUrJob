import crypto from 'node:crypto';

/**
 * Coffre des identifiants de plateformes.
 *
 * Un mot de passe n'est jamais écrit en clair, jamais renvoyé au front, et
 * n'est déchiffré qu'au moment de remplir un formulaire de connexion.
 *
 * La clé vit dans l'environnement (`CREDENTIALS_KEY`), pas en base : quelqu'un
 * qui obtient une copie de la base Mongo n'obtient rien d'exploitable. En
 * contrepartie, perdre la clé rend les mots de passe stockés illisibles — c'est
 * le comportement voulu.
 *
 * Sans clé configurée, le stockage est refusé net plutôt que dégradé en clair.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // taille nominale d'un nonce GCM
const KEY_BYTES = 32;

export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Accepte la clé en hexadécimal (64 caractères) ou en base64 (44 caractères). */
function readKey() {
  const raw = (process.env.CREDENTIALS_KEY || '').trim();
  if (!raw) return null;

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new VaultError(
      'CREDENTIALS_KEY invalide : 32 octets attendus (64 caractères hex, ou base64). ' +
        'En générer une : openssl rand -hex 32'
    );
  }
  return key;
}

export const isConfigured = () => Boolean(readKey());

/** Chiffre une valeur. Sortie : `v1.<iv>.<tag>.<chiffré>`, tout en base64url. */
export function seal(plaintext) {
  const key = readKey();
  if (!key) {
    throw new VaultError(
      "Aucune clé de chiffrement : impossible d'enregistrer un mot de passe. " +
        'Définis CREDENTIALS_KEY (openssl rand -hex 32) puis redémarre le serveur.'
    );
  }
  if (!plaintext) throw new VaultError('Valeur vide.');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/** Déchiffre. Toute altération du stockage fait échouer le contrôle d'intégrité. */
export function open(sealed) {
  const key = readKey();
  if (!key) throw new VaultError('Aucune clé de chiffrement configurée (CREDENTIALS_KEY).');

  const [version, iv, tag, payload] = String(sealed || '').split('.');
  if (version !== 'v1' || !iv || !tag || !payload) {
    throw new VaultError('Identifiant stocké illisible.');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Mauvaise clé, ou données modifiées : on ne distingue pas les deux cas.
    throw new VaultError(
      'Déchiffrement impossible : la clé a changé depuis. Ressaisis le mot de passe.'
    );
  }
}
