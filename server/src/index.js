import 'dotenv/config';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { adoptOrphans } from './utils/adoptOrphans.js';
import { dedupeApplications } from './utils/dedupeApplications.js';

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/findurjob';

const app = createApp();

// Le planificateur lit ses réglages en base : il ne démarre qu'une fois la
// connexion établie, sinon la première programmation part sur un document vide.
connectDb(MONGO_URI)
  // Les données d'avant l'authentification rejoignent le compte administrateur.
  .then(() => adoptOrphans().catch((e) => console.error('adoption :', e.message)))
  // Avant que l'index unique ne se construise : Mongo le refuserait sur des
  // doublons préexistants, et la protection manquerait sans le dire.
  .then(() => dedupeApplications().catch((e) => console.error('dédoublonnage :', e.message)))
  .then(startScheduler);

const server = app.listen(PORT, () => {
  console.log(`✓ API FindUrJob sur http://localhost:${PORT}`);
  console.log(`  Santé : http://localhost:${PORT}/api/health`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopScheduler();
    server.close(() => process.exit(0));
  });
}
