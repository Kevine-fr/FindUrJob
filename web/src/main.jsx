import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { AuthProvider } from './lib/auth.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles/tokens.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          {/* Le filet est sous les fournisseurs : une erreur de rendu doit
              pouvoir s'afficher avec les styles et les notifications en place. */}
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Uniquement sur le build de production : en développement, un service worker
// servirait d'anciens fichiers depuis son cache et masquerait les modifications
// qu'on vient d'écrire.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Hors HTTPS (ou navigateur sans support), l'application marche
      // normalement — elle n'est simplement pas installable.
    });
  });
}
