import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes.js';
import { notFound, errorHandler } from './middleware.js';
import { metricsMiddleware, metricsHandler } from './metrics.js';

/**
 * Lecture des cookies.
 *
 * `res.cookie()` fait partie d'Express ; seule la lecture manque. Une dizaine
 * de lignes suffisent, plutôt qu'une dépendance de plus dans une image qu'il
 * faut reconstruire à chaque ajout.
 */
function cookies(req, _res, next) {
  req.cookies = {};
  const entete = req.headers.cookie;
  if (entete) {
    for (const morceau of entete.split(';')) {
      const separateur = morceau.indexOf('=');
      if (separateur < 0) continue;
      const nom = morceau.slice(0, separateur).trim();
      const valeur = morceau.slice(separateur + 1).trim();
      if (nom) {
        try {
          req.cookies[nom] = decodeURIComponent(valeur);
        } catch {
          req.cookies[nom] = valeur; // valeur mal encodée : on la garde telle quelle
        }
      }
    }
  }
  next();
}

/**
 * Origines autorisées à porter une session.
 *
 * Avec des cookies, on ne peut plus répondre « toutes » : le navigateur refuse
 * `Access-Control-Allow-Credentials` accompagné d'un joker. On liste donc les
 * origines connues — l'application et la console d'administration.
 */
function corsOptions() {
  const declarees = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origine) => origine.trim())
    .filter(Boolean);

  return {
    credentials: true,
    origin(origine, callback) {
      // Sans en-tête `Origin` (appel serveur à serveur, curl) : rien à valider.
      if (!origine) return callback(null, true);
      if (declarees.includes(origine)) return callback(null, true);
      // En développement, tout localhost est accepté.
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine)) return callback(null, true);
      return callback(new Error(`Origine non autorisée : ${origine}`));
    },
  };
}

export function createApp() {
  const app = express();

  app.use(cors(corsOptions()));
  app.use(cookies);

  // Mesure des requêtes (Prometheus). Monté tôt pour couvrir aussi les 404 et
  // les erreurs, mais après CORS : une requête rejetée par CORS n'est pas du
  // trafic applicatif.
  app.use(metricsMiddleware);

  // Hors de `/api` : le nginx du conteneur web ne relaie que `/api/` et
  // `/vnc/`, l'endpoint reste donc interne au réseau Docker (Prometheus).
  app.get('/metrics', metricsHandler);

  // Le CV déposé arrive en corps brut (PDF/DOCX/TXT) : il doit être lu avant
  // le parseur JSON, qui ne saurait pas quoi en faire.
  app.use('/api/profile/cv', express.raw({ type: '*/*', limit: '6mb' }));
  // Les pièces demandées par les plateformes — une photo de profil, un
  // portfolio — arrivent de la même façon : le corps brut, le nom en en-tête.
  app.use('/api/questions/:id/fichier', express.raw({ type: '*/*', limit: '6mb' }));
  // Le document de CV envoyé à l'impression embarque ses styles et sa photo :
  // il pèse plus qu'un corps d'API ordinaire.
  app.use(express.json({ limit: '8mb' }));
  app.use(morgan('dev'));

  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
