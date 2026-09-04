/**
 * Couture du navigateur piloté (service `bot`).
 *
 * Même principe que `tailoringService` pour le moteur IA : tout ce qui parle au
 * bot passe par ici. Sans `BOT_URL`, les fonctions échouent avec un message
 * explicite plutôt que de laisser croire à une panne.
 */

const botUrl = () => process.env.BOT_URL;

function unavailable() {
  const err = new Error(
    'Navigateur piloté indisponible : démarre le service `bot` (docker compose up bot).'
  );
  err.status = 503;
  return err;
}

async function call(path, { method = 'POST', body, timeout = 180_000 } = {}) {
  const base = botUrl();
  if (!base) throw unavailable();

  // Une recherche sur trois plateformes peut durer : on borne haut, mais on borne.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const err = new Error('Le navigateur piloté met trop de temps à répondre.');
      err.status = 504;
      throw err;
    }
    // Distinguer « pas configuré » de « ne répond pas » : le premier se règle
    // dans l'environnement, le second en redémarrant le service.
    const err = new Error(
      `Le navigateur piloté ne répond pas (${base}) — service arrêté ou en cours de démarrage.`
    );
    err.status = 503;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  return response;
}

async function json(path, options) {
  const response = await call(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Navigateur piloté : ${response.status}`);
    err.status = response.status === 409 ? 409 : 502;
    // Le robot nomme la panne quand il la reconnaît : la perdre ici obligerait
    // à la redeviner depuis le message, moins bien.
    if (data.reason) err.reason = data.reason;
    throw err;
  }
  return data;
}

/** HTML → PDF. Renvoie le binaire et ce que l'ajustement a dû faire. */
export async function renderCvPdf(html) {
  const response = await call('/pdf', { body: { html }, timeout: 60_000 });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const err = new Error(data.error || `Rendu PDF : ${response.status}`);
    err.status = 502;
    throw err;
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    fit: {
      density: Number(response.headers.get('X-Cv-Density')) || 1,
      trimmed: Number(response.headers.get('X-Cv-Trimmed')) || 0,
      overflow: response.headers.get('X-Cv-Overflow') === 'true',
      fill: Number(response.headers.get('X-Cv-Fill')) || 0,
    },
  };
}

export const botSessions = (user) => json(`/sessions?user=${encodeURIComponent(user)}`, { method: 'GET' });

export const botLogin = (platform, email, password, user) =>
  json('/login', { body: { platform, user, email, password }, timeout: 120_000 });

/**
 * Ce que la plateforme dit avoir recu.
 *
 * Long par nature : la lecture parcourt plusieurs pages dans un navigateur
 * complet. Le delai par defaut du service serait bien trop court.
 */
export const botCandidatures = (platform, user, max = 200) =>
  json(
    `/candidatures?platform=${encodeURIComponent(platform)}&user=${encodeURIComponent(user)}&max=${max}`,
    { method: "GET", timeout: 240_000 }
  );

export const botSearch = (platform, query, user) =>
  json('/search', { body: { platform, user, ...query } });

/**
 * Candidate sur la plateforme, CV joint.
 * `cv` : { filename, content } où `content` est le PDF en base64 — il voyage
 * dans la requête, faute de disque partagé entre le serveur et le bot.
 */
export const botApply = (platform, offer, cv, user, extra = {}) =>
  json('/apply', { body: { platform, user, offer, cv, ...extra }, timeout: 240_000 });

/**
 * Ouvre une page sur l'écran du conteneur, pour reprise en main.
 * `target` : plateforme | google | gmail — toujours dans le navigateur de la
 * plateforme visée, seul endroit où les cookies Google lui serviront.
 */
export const botManualOpen = (platform, target = 'plateforme', user) =>
  json('/manual', { body: { platform, user, target }, timeout: 60_000 });

/** La plateforme reconnaît-elle la session que l'utilisateur vient d'ouvrir ? */
export const botManualStatus = (platform, user) =>
  json(`/manual/${platform}?user=${encodeURIComponent(user)}`, { method: 'GET', timeout: 60_000 });

/** État du bot, dont la disponibilité de la reprise en main. */
export const botHealth = () => json('/health', { method: 'GET', timeout: 10_000 });

/**
 * Adresse de l'écran noVNC **telle que le navigateur de l'utilisateur peut la
 * joindre** — donc pas le nom de service Docker. En production, elle passe par
 * le proxy du front (/vnc), qui sait relayer le websocket.
 */
export const botVncUrl = () => process.env.BOT_VNC_URL || '';

export const botForget = (platform, purge = false, user) =>
  call(`/sessions/${platform}?user=${encodeURIComponent(user)}${purge ? '&purge=1' : ''}`, { method: 'DELETE', timeout: 30_000 });

export const botConfigured = () => Boolean(botUrl());
