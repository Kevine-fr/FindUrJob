import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';

/**
 * Notifications push du navigateur (Web Push).
 *
 * Le protocole repose sur une paire de clés VAPID : la publique est remise au
 * navigateur au moment de l'abonnement, la privée signe nos envois. Elles
 * doivent rester **stables** — les régénérer invalide tous les abonnements
 * existants d'un coup, et chacun devrait réautoriser les notifications.
 *
 *   npx web-push generate-vapid-keys
 *
 * Sans clés configurées, tout ici rend la main proprement : l'application
 * fonctionne, seul le canal push est annoncé comme indisponible. C'est
 * volontaire — une fonctionnalité absente doit se dire, pas planter.
 */

let pret = null;

export function pushConfigured() {
  if (pret !== null) return pret;

  const publique = process.env.VAPID_PUBLIC_KEY;
  const privee = process.env.VAPID_PRIVATE_KEY;

  if (!publique || !privee) {
    pret = false;
    return pret;
  }

  try {
    webpush.setVapidDetails(
      // Le sujet doit être une adresse de contact : les services de push s'en
      // servent pour joindre l'émetteur en cas d'abus.
      process.env.VAPID_SUBJECT || 'mailto:no-reply@findurjob.local',
      publique,
      privee
    );
    pret = true;
  } catch (error) {
    console.error('clés VAPID invalides :', error.message);
    pret = false;
  }
  return pret;
}

export function publicKey() {
  return pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null;
}

/**
 * Envoie une notification à tous les appareils d'un compte.
 *
 * Un abonnement mort (404 ou 410) est supprimé : le navigateur l'a révoqué —
 * notifications refusées, application désinstallée, cache effacé. Le garder
 * ferait échouer chaque envoi suivant pour rien.
 *
 * Rend le nombre d'appareils réellement touchés.
 */
export async function notifier(user, { title, body, url, tag }) {
  if (!pushConfigured()) return { sent: 0, reason: 'push non configuré (clés VAPID absentes)' };

  const abonnements = await PushSubscription.find({ user });
  if (!abonnements.length) return { sent: 0, reason: 'aucun appareil abonné' };

  const charge = JSON.stringify({ title, body, url: url || '/', tag: tag || 'findurjob' });
  let envoyees = 0;
  const perimes = [];

  for (const abonnement of abonnements) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abonnement.endpoint,
          keys: { p256dh: abonnement.keys.p256dh, auth: abonnement.keys.auth },
        },
        charge,
        { TTL: 3600 }
      );
      envoyees += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) perimes.push(abonnement._id);
      else console.warn('push refusé :', error.statusCode, error.message?.slice(0, 120));
    }
  }

  if (perimes.length) await PushSubscription.deleteMany({ _id: { $in: perimes } });

  return { sent: envoyees, removed: perimes.length };
}
