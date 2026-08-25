import { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import OffersPage from './pages/OffersPage.jsx';
import OfferDetailPage from './pages/OfferDetailPage.jsx';
import MapPage from './pages/MapPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import PreferencesPage from './pages/PreferencesPage.jsx';
import CvBuilderPage from './pages/CvBuilderPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import CampaignPage from './pages/CampaignPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import PasswordPage from './pages/PasswordPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { useAuth } from './lib/auth.jsx';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };

const NAV = [
  {
    to: '/offres',
    label: 'Offres',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
      </svg>
    ),
  },
  {
    to: '/carte',
    label: 'Carte',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V4L15 6.2 9 4z" />
        <path d="M9 4v13.3M15 6.2v13.3" />
      </svg>
    ),
  },
  {
    to: '/candidatures',
    label: 'Candidatures',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M14 3v5h5M8.5 14.5l2 2 4-4.5" />
      </svg>
    ),
  },
  {
    to: '/historique',
    label: 'Historique',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    to: '/preferences',
    label: 'Préférences',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2.2" />
        <circle cx="8" cy="17" r="2.2" />
      </svg>
    ),
  },
  {
    to: '/campagne',
    label: 'Campagne',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
        <path d="M12 3v1M21 12h-1M12 21v-1M3 12h1" />
      </svg>
    ),
  },
  {
    to: '/comptes',
    label: 'Comptes',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="10" width="18" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
      </svg>
    ),
  },
  {
    to: '/mon-cv',
    label: 'Mon CV',
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h4M8 12h8M8 16h8" />
      </svg>
    ),
  },
];

const ADMIN_NAV = {
  to: '/admin',
  label: 'Administration',
  icon: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3l8 3.5v5c0 4.6-3.2 8.4-8 9.5-4.8-1.1-8-4.9-8-9.5v-5L12 3z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  ),
};

/**
 * Bouton d'installation.
 *
 * Le navigateur décide seul si l'application est installable ; il le signale
 * par `beforeinstallprompt`. Tant que l'événement n'est pas venu, on n'affiche
 * rien plutôt qu'un bouton qui ne ferait rien. (iOS ne l'émet jamais :
 * l'installation y passe par « Partager → Sur l'écran d'accueil ».)
 */
function InstallButton() {
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const capture = (event) => {
      event.preventDefault();
      setPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', () => setPrompt(null));
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  if (!prompt) return null;

  return (
    <button
      className="btn btn-sm btn-block"
      style={{ marginBottom: 10 }}
      onClick={async () => {
        prompt.prompt();
        await prompt.userChoice;
        setPrompt(null); // l'événement ne peut être consommé qu'une fois
      }}
    >
      Installer l'application
    </button>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const { user, ready, logout, isAdmin } = useAuth();

  // Changer de page ferme le tiroir : sinon il masque la page qu'on vient d'ouvrir.
  useEffect(() => setMenuOpen(false), [pathname]);

  // Échap ferme le tiroir, et le fond ne défile plus derrière lui.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const brand = (
    <div className="brand">
      <img src="/favicon.svg" alt="" width="26" height="26" />
      <span className="brand-text">
        FindUr<span>Job</span>
      </span>
    </div>
  );

  /*
   * La session vit dans un cookie que le JavaScript ne peut pas lire : son état
   * arrive du serveur. Tant qu'il n'est pas connu, on n'affiche ni l'écran de
   * connexion (qui clignoterait devant quelqu'un de déjà connecté) ni
   * l'application (qui déclencherait des appels voués au 401).
   */
  if (!ready) {
    return (
      <div className="auth-shell">
        <div className="auth-splash">
          <img src="/favicon.svg" alt="" width="44" height="44" />
        </div>
      </div>
    );
  }

  /*
   * Deux routes restent ouvertes sans session.
   *
   * Elles s’atteignent par un lien de courriel : renvoyer vers l’écran de
   * connexion perdrait le jeton présent dans l’URL, et la personne ne pourrait
   * précisément pas se connecter — c’est la raison de sa venue.
   */
  if (!user) {
    return (
      <Routes>
        <Route path="/mot-de-passe" element={<PasswordPage />} />
        <Route path="/verifier-email" element={<VerifyEmailPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="burger"
          onClick={() => setMenuOpen(true)}
          aria-label="Ouvrir le menu"
          aria-expanded={menuOpen}
        >
          <svg viewBox="0 0 24 24" {...stroke}>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {brand}
      </header>

      {menuOpen && (
        <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu" />
      )}

      <aside className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        {brand}
        {[...NAV, ...(isAdmin ? [ADMIN_NAV] : [])].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <div className="nav-spacer" />
        <InstallButton />
        <div className="nav-foot">
          {/* Le bloc identité mène à l’espace compte : c’est là qu’on cherche
              son profil, pas dans un menu séparé. */}
          <NavLink className="nav-user" to="/compte" title={user?.email}>
            <span className="nav-avatar">{(user?.fullName || user?.email || '?').charAt(0).toUpperCase()}</span>
            <span className="nav-user-name">{user?.fullName || user?.email}</span>
          </NavLink>
          <button className="btn btn-ghost btn-sm btn-block" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="main">
        {/* La clé sur la route rejoue l'animation d'entrée à chaque changement de page. */}
        <div key={pathname} className="animate-in">
          <Routes>
            <Route path="/" element={<Navigate to="/offres" replace />} />
            <Route path="/offres" element={<OffersPage />} />
            <Route path="/offres/:id" element={<OfferDetailPage />} />
            <Route path="/carte" element={<MapPage />} />
            <Route path="/candidatures" element={<ApplicationsPage />} />
            <Route path="/historique" element={<HistoryPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="/campagne" element={<CampaignPage />} />
            <Route path="/comptes" element={<AccountsPage />} />
            <Route path="/mon-cv" element={<CvBuilderPage />} />
            <Route path="/compte" element={<AccountPage />} />
            <Route path="/verifier-email" element={<VerifyEmailPage />} />
            {/* La console n'existe que pour un administrateur : sans ce garde,
                l'URL suffirait à en afficher la coquille (l'API, elle, refuse). */}
            <Route
              path="/admin"
              element={isAdmin ? <AdminPage /> : <Navigate to="/offres" replace />}
            />
            {/* Ancienne adresse du profil : on redirige plutôt que de casser un signet. */}
            <Route path="/profil" element={<Navigate to="/mon-cv" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
