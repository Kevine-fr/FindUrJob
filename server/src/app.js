import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes.js';
import { notFound, errorHandler } from './middleware.js';

export function createApp() {
  const app = express();

  app.use(cors());
  // Le CV déposé arrive en corps brut (PDF/DOCX/TXT) : il doit être lu avant
  // le parseur JSON, qui ne saurait pas quoi en faire.
  app.use('/api/profile/cv', express.raw({ type: '*/*', limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
