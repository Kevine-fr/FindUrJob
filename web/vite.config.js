import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Vite refuse les requêtes dont l'en-tête Host lui est inconnu (protection
    // contre le rebinding DNS). En production, le site est compilé et servi par
    // nginx, donc la question ne se pose pas ; ce réglage ne sert qu'au serveur
    // de développement joint par un nom de domaine plutôt que par localhost.
    //   VITE_ALLOWED_HOSTS=mon-domaine.fr,autre.fr
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      // En dev, /api est relayé vers l'API Node.
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
