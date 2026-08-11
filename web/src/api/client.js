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

export const api = {
  health: () => req('/health'),

  offers: {
    list: (query = '') => req(`/offers${query}`),
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

  profile: {
    get: () => req('/profile'),
    update: (body) => req('/profile', { method: 'PUT', body: JSON.stringify(body) }),
  },
};
