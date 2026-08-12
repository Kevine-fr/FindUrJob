import { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import OffersPage from './pages/OffersPage.jsx';
import OfferDetailPage from './pages/OfferDetailPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import PreferencesPage from './pages/PreferencesPage.jsx';
import CvBuilderPage from './pages/CvBuilderPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';

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
        {NAV.map((item) => (
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
        <div className="nav-foot">Copilote de candidatures</div>
      </aside>

      <main className="main">
        {/* La clé sur la route rejoue l'animation d'entrée à chaque changement de page. */}
        <div key={pathname} className="animate-in">
          <Routes>
            <Route path="/" element={<Navigate to="/offres" replace />} />
            <Route path="/offres" element={<OffersPage />} />
            <Route path="/offres/:id" element={<OfferDetailPage />} />
            <Route path="/candidatures" element={<ApplicationsPage />} />
            <Route path="/historique" element={<HistoryPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="/comptes" element={<AccountsPage />} />
            <Route path="/mon-cv" element={<CvBuilderPage />} />
            {/* Ancienne adresse du profil : on redirige plutôt que de casser un signet. */}
            <Route path="/profil" element={<Navigate to="/mon-cv" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
