import PlatformAccount from '../models/PlatformAccount.js';
import { botLogin } from './botService.js';
import { open } from '../utils/vault.js';

/**
 * Rouvre une session expirée avec les identifiants déjà enregistrés.
 *
 * Une session finit toujours par expirer — France Travail est le plus court.
 * La campagne se contentait alors d'échouer plateforme par plateforme, et il
 * fallait rouvrir l'onglet Comptes pour cliquer « Ouvrir la session ». Or les
 * identifiants sont déjà là, chiffrés : autant réessayer une fois.
 *
 * On ne réessaie **qu'une seule fois par passe** et seulement si un mot de passe
 * est enregistré. S'acharner sur une plateforme qui exige une vérification à
 * deux facteurs ne la ferait pas céder — cela déclencherait surtout des alertes
 * de sécurité sur le compte de la personne, voire un blocage.
 *
 * @returns {Promise<boolean>} `true` si la session est de nouveau ouverte.
 */
export async function tryRevive(platform, user) {
  const account = await PlatformAccount.findOne({ platform, user }).select('+password');

  // Sans identifiants enregistrés, il n'y a rien à rejouer : c'est le cas des
  // plateformes ouvertes uniquement par reprise en main.
  if (!account?.email || !account.password) return false;

  let password;
  try {
    password = open(account.password);
  } catch {
    return false; // clé de coffre absente ou changée : on ne devine pas
  }
  if (!password) return false;

  try {
    const result = await botLogin(platform, account.email, password, user);

    const STATE = { connected: 'connectee', verification: 'verification', failed: 'erreur' };
    account.sessionState = STATE[result.status] || 'erreur';
    account.lastMessage = result.message || '';
    account.lastCheckedAt = new Date();
    if (result.status === 'connected') account.lastLoginAt = new Date();
    await account.save();

    return result.status === 'connected';
  } catch {
    // Une reconnexion qui échoue ne doit pas faire tomber la passe : la
    // candidature repart en « à finir à la main », comme avant.
    return false;
  }
}
