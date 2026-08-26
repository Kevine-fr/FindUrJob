import { api } from '../api/client.js';

/**
 * Notifications du navigateur : abonnement, désabonnement, état.
 *
 * Trois conditions doivent être réunies, et l'utilisateur doit savoir laquelle
 * manque : un service worker (donc une origine sécurisée — HTTPS ou localhost),
 * l'API Push du navigateur, et une clé publique côté serveur. Un bouton qui ne
 * fait rien sans expliquer pourquoi est pire que pas de bouton du tout.
 *
 * iOS est le cas particulier qui surprend : Safari ne permet les notifications
 * que pour une application **ajoutée à l'écran d'accueil**, pas depuis l'onglet.
 */

export function pushSupporte() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iOS n'autorise le push qu'en application installée. */
export function iosSansInstallation() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installee = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone;
  return ios && !installee;
}

/**
 * Le service worker, enregistré à la demande.
 *
 * En développement il ne l'est pas au démarrage — il servirait d'anciens
 * fichiers depuis son cache et masquerait les modifications en cours. Mais sans
 * lui, aucune notification n'est possible : on l'enregistre donc au moment où
 * quelqu'un demande explicitement les notifications, et pas avant.
 */
async function serviceWorker() {
  const existant = await navigator.serviceWorker.getRegistration();
  if (existant) return existant;
  return navigator.serviceWorker.register('/sw.js');
}

/** La clé VAPID voyage en base64url ; l'API Push attend des octets. */
function versOctets(base64url) {
  const bourrage = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + bourrage).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(base64);
  return Uint8Array.from([...brut].map((c) => c.charCodeAt(0)));
}

/** Un nom d'appareil lisible, pour s'y retrouver dans la liste. */
function etiquetteAppareil() {
  const ua = navigator.userAgent;
  const navigateur =
    /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const systeme =
    /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'Ordinateur';
  return `${navigateur} sur ${systeme}`;
}

/** L'abonnement de cet appareil, s'il existe déjà. */
export async function abonnementActuel() {
  if (!pushSupporte()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Active les notifications sur cet appareil.
 * Rend `{ ok, raison }` — jamais une exception : chaque refus a une cause qu'il
 * faut pouvoir afficher telle quelle.
 */
export async function activerPush() {
  if (!pushSupporte()) {
    return { ok: false, raison: "Ce navigateur ne gère pas les notifications push." };
  }
  if (iosSansInstallation()) {
    return {
      ok: false,
      raison:
        "Sur iPhone, les notifications ne fonctionnent que si l'application est " +
        "ajoutée à l'écran d'accueil (Partager → Sur l'écran d'accueil).",
    };
  }

  const { configured, key } = await api.push.key().catch(() => ({ configured: false }));
  if (!configured || !key) {
    return {
      ok: false,
      raison:
        "Le serveur n'a pas de clés VAPID : les notifications push ne sont pas " +
        'encore activables. Le canal courriel, lui, fonctionne.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, raison: 'Notifications refusées dans le navigateur.' };
  }

  try {
    const registration = await serviceWorker();
    await navigator.serviceWorker.ready;

    // Un abonnement existant peut viser une ancienne clé : on le remplace
    // plutôt que de le réutiliser, sinon les envois échoueraient en silence.
    const ancien = await registration.pushManager.getSubscription();
    if (ancien) await ancien.unsubscribe().catch(() => {});

    const abonnement = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: versOctets(key),
    });

    const brut = abonnement.toJSON();
    await api.push.subscribe({
      endpoint: brut.endpoint,
      keys: brut.keys,
      label: etiquetteAppareil(),
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, raison: error.message };
  }
}

/** Coupe les notifications sur cet appareil, des deux côtés. */
export async function desactiverPush() {
  const abonnement = await abonnementActuel();
  if (!abonnement) return { ok: true };

  const { endpoint } = abonnement.toJSON();
  await abonnement.unsubscribe().catch(() => {});
  await api.push.unsubscribe(endpoint).catch(() => {});
  return { ok: true };
}
