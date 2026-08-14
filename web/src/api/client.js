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
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
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
  },

  offers: {
    // Réponse paginée : { offers, total, page, pages, limit }
    list: (query = '') => req(`/offers${query}`),
    sync: (body = {}) => req('/offers/sync', { method: 'POST', body: JSON.stringify(body) }),
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
    remove: (id) => req(`/applications/${id}`, { method: 'DELETE' }),
  },

  history: {
    list: (query = '') => req(`/history${query}`),
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
    updateUser: (id, body) => req(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteUser: (id) => req(`/admin/users/${id}`, { method: 'DELETE' }),
  },

  campaign: {
    get: () => req('/campaign'),
    update: (body) => req('/campaign', { method: 'PUT', body: JSON.stringify(body) }),
    run: (dryRun = false) =>
      req(`/campaign/run${dryRun ? '?dryRun=1' : ''}`, { method: 'POST' }),
  },
};
