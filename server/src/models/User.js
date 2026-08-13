import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

/**
 * Un compte FindUrJob.
 *
 * Le mot de passe n'est jamais stocké : seul son empreinte scrypt l'est, avec
 * un sel propre à chaque compte. scrypt est volontairement lent et gourmand en
 * mémoire — c'est ce qui rend une fuite de la base peu exploitable.
 *
 * À ne pas confondre avec `PlatformAccount`, qui garde les identifiants
 * *externes* (LinkedIn, Indeed…) chiffrés et réversibles, parce qu'il faut les
 * rejouer dans un formulaire. Ici, on n'a jamais besoin de relire le mot de
 * passe : on compare des empreintes.
 */
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    fullName: { type: String, default: '', trim: true },

    // `select: false` : l'empreinte ne part jamais dans une réponse par accident.
    passwordHash: { type: String, required: true, select: false },

    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },

    // Un compte désactivé garde ses données mais ne peut plus se connecter :
    // préférable à une suppression, qui emporterait tout son historique.
    active: { type: Boolean, default: true },

    lastLoginAt: { type: Date },
    loginCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const KEY_LENGTH = 64;

/** `scrypt$<sel hex>$<empreinte hex>` — le format porte sa propre description. */
async function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await hash(password);
};

/**
 * Comparaison en temps constant : un `===` révélerait par sa durée combien de
 * caractères de tête sont corrects.
 */
userSchema.methods.checkPassword = async function (password) {
  const stored = this.passwordHash;
  if (!stored) return false;

  const [algo, salt, empreinte] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !empreinte) return false;

  const derived = await scrypt(password, salt, KEY_LENGTH);
  const attendu = Buffer.from(empreinte, 'hex');
  return derived.length === attendu.length && crypto.timingSafeEqual(derived, attendu);
};

/** Vue sûre : ni empreinte, ni champs internes. */
userSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    email: this.email,
    fullName: this.fullName,
    role: this.role,
    active: this.active,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
    loginCount: this.loginCount,
  };
};

/**
 * Crée un compte. Le tout premier devient administrateur : sans cela, une
 * installation neuve n'aurait personne pour accéder à l'espace d'administration.
 */
userSchema.statics.register = async function ({ email, password, fullName }) {
  const premier = (await this.estimatedDocumentCount()) === 0;
  const user = new this({ email, fullName, role: premier ? 'admin' : 'user' });
  await user.setPassword(password);
  await user.save();
  return user;
};

export default mongoose.model('User', userSchema);
