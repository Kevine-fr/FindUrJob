/**
 * Métriques Prometheus de l'API.
 *
 * Exposées sur `GET /metrics`, en dehors de `/api` : le nginx du conteneur web
 * ne relaie que `/api/` et `/vnc/`, l'endpoint n'est donc pas joignable depuis
 * l'extérieur. C'est Prometheus, sur le réseau Docker « web », qui vient le
 * lire (`findurjob-api:4000/metrics`).
 *
 * Conventions de nommage alignées sur les autres services du VPS
 * (`http_request_duration_seconds{method,route,status_code}`), pour que les
 * dashboards Grafana existants fonctionnent sans variante par application.
 */
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export const registry = new Registry();

// Métriques runtime Node : heap, GC, event-loop lag, CPU, descripteurs.
collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Nombre de requêtes HTTP servies.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP, en secondes.',
  labelNames: ['method', 'route', 'status_code'],
  // Mêmes bornes que les autres services : une comparaison entre applications
  // n'a de sens que sur des seaux identiques.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * Identifiant de route stable.
 *
 * Express expose le modèle de route (`/applications/:id`) une fois la requête
 * routée : c'est lui qu'il faut, pas l'URL réelle. Sans cela, chaque
 * identifiant créerait une série de plus et ferait exploser la cardinalité
 * (et la mémoire de Prometheus) au fil des candidatures.
 */
function routeOf(req) {
  if (req.route?.path) {
    const base = req.baseUrl || '';
    const path = req.route.path === '/' ? '' : req.route.path;
    return `${base}${path}` || '/';
  }
  // Requête non routée (404, erreur avant routage) : on retombe sur un
  // gabarit générique, jamais sur l'URL brute.
  return req.baseUrl || 'unmatched';
}

/** Middleware à monter avant les routes : mesure toutes les réponses. */
export function metricsMiddleware(req, res, next) {
  // L'appel de Prometheus lui-même n'a pas à figurer dans les statistiques.
  if (req.path === '/metrics') return next();

  const stop = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: routeOf(req),
      status_code: String(res.statusCode),
    };
    stop(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

/** Handler de `GET /metrics` (format texte Prometheus). */
export async function metricsHandler(_req, res) {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
