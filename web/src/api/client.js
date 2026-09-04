const BASE = import.meta.env.VITE_API_URL || '/api';

// Exposée pour les ressources qu'on ne récupère pas en fetch mais qu'on pointe
// directement (le PDF d'un CV dans une iframe ou un lien de téléchargement).
export const API_BASE = BASE;

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    // Sans cela, le navigateur n'envoie pas le cookie de session sur une
    // requête vers une autre origine — l'API répondrait 401 en permanence.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    /*
     * Le corps de l'erreur voyage avec elle.
     *
     * Certains refus portent plus qu'une phrase : la relance d'une candidature
     * « à vérifier » répond `needsConfirmation`, et l'appelant doit pouvoir
     * distinguer « impossible » de « demande d'abord ». Ne garder que le
     * message obligeait à relire cette nuance dans le texte, ce qui casse à la
     * première reformulation.
     */
    const erreur = new Error(data.error || `Erreur ${res.status}`);
    erreur.status = res.status;
    erreur.payload = data;
    throw erreur;
  }
  return data;
}

// Envoi d'un fichier en corps brut : le nom passe par un en-tête (les en-têtes
// HTTP ne supportent que l'ASCII, d'où l'encodage).
async function upload(path, file) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

/**
 * Récupère un PDF.
 *
 * Le corps est binaire, mais les en-têtes disent ce que l'ajustement à une page
 * a coûté (densité, puces retirées) : on rend les deux, sinon l'appelant ne
 * peut pas prévenir l'utilisateur que son CV a été compacté.
 */
async function pdf(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }

  return {
    blob: await res.blob(),
    fit: {
      density: Number(res.headers.get('X-Cv-Density')) || 1,
      trimmed: Number(res.headers.get('X-Cv-Trimmed')) || 0,
      overflow: res.headers.get('X-Cv-Overflow') === 'true',
      fill: Number(res.headers.get('X-Cv-Fill')) || 0,
    },
  };
}

export const api = {
  health: () => req('/health'),

  auth: {
    me: () => req('/auth/me'),
    login: (email, password) =>
      req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (body) =>
      req('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => req('/auth/logout', { method: 'POST' }),
    update: (body) => req('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),

    // --- Compte ---
    remove: (body) => req('/auth/me', { method: 'DELETE', body: JSON.stringify(body) }),
    sendVerification: () => req('/auth/verify/send', { method: 'POST' }),
    verifyEmail: (token) =>
      req('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    forgotPassword: (email) =>
      req('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (token, password) =>
      req('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
    changePassword: (current, password) =>
      req('/auth/password/change', { method: 'POST', body: JSON.stringify({ current, password }) }),
  },

  // La version de ce qui tourne réellement, servie par /health.
  version: () => req('/health'),

  offers: {
    // Réponse paginée : { offers, total, page, pages, limit }
    list: (query = '') => req(`/offers${query}`),
    sync: (body = {}) => req('/offers/sync', { method: 'POST', body: JSON.stringify(body) }),
    // Offres situées + combien restent à géocoder.
    map: (query = '') => req(`/offers/map${query}`),
    get: (id) => req(`/offers/${id}`),
    create: (body) => req('/offers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => req(`/offers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => req(`/offers/${id}`, { method: 'DELETE' }),
  },

  applications: {
    list: (query = '') => req(`/applications${query}`),
    get: (id) => req(`/applications/${id}`),
    create: (body) => req('/applications', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) =>
      req(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    setStatus: (id, status, note) =>
      req(`/applications/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note }),
      }),
    tailor: (id) => req(`/applications/${id}/tailor`, { method: 'POST' }),
    /*
     * Relance un envoi qui n'a pas abouti.
     *
     * `force` traduit un geste explicite — « j'ai vérifié sur la plateforme,
     * rien n'est arrivé ». Sans lui, une candidature « à vérifier » n'est
     * jamais renvoyée sans preuve : c'est ce qui évite le double envoi.
     */
    retry: (id, { force = false } = {}) =>
      req(`/applications/${id}/retry`, { method: 'POST', body: JSON.stringify({ force }) }),
    // Demande aux plateformes ce qu elles ont recu, et promeut ce qu elles
    // reconnaissent. Long : plusieurs pages lues dans un navigateur complet.
    reconcile: () => req('/applications/reconcile', { method: 'POST' }),
    remove: (id) => req(`/applications/${id}`, { method: 'DELETE' }),
  },

  history: {
    list: (query = '') => req(`/history${query}`),
  },

  /*
   * Informations réclamées par les plateformes, et diagnostic des blocages.
   * Les deux arrivent ensemble : ils se lisent ensemble.
   */
  questions: {
    list: (query = '') => req(`/questions${query}`),
    answerFile: (id, file) => upload('/questions/' + id + '/fichier', file),
    answer: (id, body) => req(`/questions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => req(`/questions/${id}`, { method: 'DELETE' }),
  },

  preferences: {
    get: () => req('/preferences'),
    update: (body) => req('/preferences', { method: 'PUT', body: JSON.stringify(body) }),
  },

  profile: {
    get: () => req('/profile'),
    update: (body) => req('/profile', { method: 'PUT', body: JSON.stringify(body) }),
    uploadCv: (file) => upload('/profile/cv', file),
    removeCv: () => req('/profile/cv', { method: 'DELETE' }),
    composeCv: (fields) => req('/profile/compose', { method: 'POST', body: JSON.stringify(fields) }),
    // Reprendre les rubriques du dernier import, ou choisir lequel des deux CV
    // fait foi. Deux gestes séparés du dépôt : ce sont des choix distincts.
    applyCvFields: () => req('/profile/cv/fields', { method: 'POST' }),
    setCvMode: (mode) => req('/profile/cv-mode', { method: 'PUT', body: JSON.stringify({ mode }) }),
  },

  cv: {
    pdf: (html, filename) => pdf('/cv/pdf', { html, filename }),
  },

  accounts: {
    list: () => req('/accounts'),
    save: (platform, body) =>
      req(`/accounts/${platform}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (platform) => req(`/accounts/${platform}`, { method: 'DELETE' }),
    login: (platform, password) =>
      req(`/accounts/${platform}/login`, {
        method: 'POST',
        body: JSON.stringify(password ? { password } : {}),
      }),
    logout: (platform) => req(`/accounts/${platform}/logout`, { method: 'POST' }),
    // Reprise en main : ouvre la page de connexion dans le navigateur piloté,
    // puis vérifie que la plateforme reconnaît bien la session.
    // `target` : plateforme | google | gmail — ouvert dans le navigateur de
    // la plateforme, seul profil où les cookies Google lui serviront.
    openManual: (platform, target = 'plateforme') =>
      req(`/accounts/${platform}/manual`, {
        method: 'POST',
        body: JSON.stringify({ target }),
      }),
    checkManual: (platform) => req(`/accounts/${platform}/manual`),
  },

  admin: {
    overview: (days = 30) => req(`/admin/overview?days=${days}`),
    users: () => req('/admin/users'),
    // Le fil d'un compte, bornable dans le temps. Même service que l'onglet
    // Historique de la personne : les deux écrans ne peuvent pas diverger.
    userActivity: (id, query = '') => req(`/admin/users/${id}/activity${query}`),
    updateUser: (id, body) => req(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteUser: (id) => req(`/admin/users/${id}`, { method: 'DELETE' }),
  },

  alerts: {
    // Réponse : { alerts, channels } — `channels` dit ce qui est réellement
    // disponible côté serveur (SMTP configuré, clés VAPID présentes).
    list: () => req('/alerts'),
    create: (body) => req('/alerts', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => req(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => req(`/alerts/${id}`, { method: 'DELETE' }),
    // Regarde sans rien envoyer ni entamer de quota.
    preview: (id) => req(`/alerts/${id}/preview`, { method: 'POST' }),
    run: (id) => req(`/alerts/${id}/run`, { method: 'POST' }),
  },

  push: {
    key: () => req('/push/key'),
    subscribe: (body) => req('/push/subscribe', { method: 'POST', body: JSON.stringify(body) }),
    unsubscribe: (endpoint) =>
      req('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
    test: () => req('/push/test', { method: 'POST' }),
  },

  campaign: {
    get: () => req('/campaign'),
    update: (body) => req('/campaign', { method: 'PUT', body: JSON.stringify(body) }),
    run: (dryRun = false) =>
      req(`/campaign/run${dryRun ? '?dryRun=1' : ''}`, { method: 'POST' }),
  },
};
