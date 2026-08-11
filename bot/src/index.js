import { createApp } from './app.js';
import { shutdown } from './browser.js';

const PORT = Number(process.env.PORT) || 8100;

const server = createApp().listen(PORT, '0.0.0.0', () => {
  console.log(`findurjob-bot écoute sur :${PORT}`);
});

// Sans cette fermeture, Chromium survit au conteneur et garde le profil verrouillé :
// le redémarrage suivant ne peut plus rouvrir la session.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    server.close();
    await shutdown();
    process.exit(0);
  });
}
