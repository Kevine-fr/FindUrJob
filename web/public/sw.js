/**
 * Service worker de FindUrJob.
 *
 * Objectif : l'application s'ouvre et reste navigable hors connexion. Pas de
 * mise en cache des données — une offre ou une candidature affichée doit être
 * la vraie, jamais une copie d'hier.
 *
 * Écrit à la main plutôt que généré : la stratégie tient en trois règles, et
 * elles méritent d'être lisibles.
 */

const VERSION = 'v1';
const SHELL = `findurjob-shell-${VERSION}`;
const ASSETS = `findurjob-assets-${VERSION}`;

// Le strict nécessaire pour afficher quelque chose sans réseau.
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // `addAll` échoue en bloc si une seule URL manque : on met en cache
      // une par une pour qu'un fichier absent ne fasse pas capoter l'install.
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== SHELL && key !== ASSETS).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Une écriture (POST /api/cv/pdf, PUT /api/accounts…) ne se met jamais en cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // L'API n'est jamais servie depuis le cache : afficher des offres périmées
  // ou un état de session dépassé serait pire que d'afficher une erreur.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation : le réseau d'abord, la coquille en secours. C'est ce qui
  // permet d'ouvrir l'application dans le métro.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((hit) => hit || Response.error()))
    );
    return;
  }

  // Fichiers compilés : leur nom contient une empreinte, leur contenu ne change
  // donc jamais sous une même URL. Le cache d'abord, sans revalidation.
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});

/* ------------------------------------------------------------------ *
 * Notifications push
 *
 * Le serveur envoie un message chiffré ; c'est ici qu'il devient une
 * notification. Le corps est du JSON, mais on ne s'y fie pas aveuglément : un
 * service de push peut réveiller le worker sans charge utile, et une exception
 * ici ferait disparaître la notification sans laisser de trace.
 * ------------------------------------------------------------------ */

self.addEventListener('push', (event) => {
  let charge = {};
  try {
    charge = event.data ? event.data.json() : {};
  } catch {
    charge = { body: event.data && event.data.text ? event.data.text() : '' };
  }

  /*
   * Le titre ne reprend jamais le nom de l'application.
   *
   * Le navigateur ajoute déjà sa propre mention d'origine sous la notification
   * (« from FindUrJob ») — c'est une protection contre l'usurpation, et aucune
   * API ne permet de la retirer. Y remettre le nom en titre le faisait
   * apparaître deux fois pour rien.
   */
  const titre = charge.title || 'Nouvelle correspondance';
  const options = {
    body: charge.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Le `tag` regroupe : une deuxième alerte du même type remplace la
    // précédente au lieu d'empiler des bannières identiques.
    tag: charge.tag || 'findurjob',
    data: { url: charge.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(titre, options));
});

/*
 * Un clic ouvre l'application à l'endroit concerné. Si un onglet est déjà
 * ouvert, on l'y amène plutôt que d'en ouvrir un second — c'est ce qu'attend
 * quelqu'un qui a l'application installée.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const cible = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      for (const fenetre of fenetres) {
        if ('focus' in fenetre) {
          fenetre.navigate(cible).catch(() => {});
          return fenetre.focus();
        }
      }
      return self.clients.openWindow(cible);
    })
  );
});
