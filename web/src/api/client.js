const BASE = import.meta.env.VITE_API_URL || '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
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

export const api = {
  health: () => req('/health'),

  offers: {
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
};
