import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import OffersPage from './pages/OffersPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import PreferencesPage from './pages/PreferencesPage.jsx';
import CvBuilderPage from './pages/CvBuilderPage.jsx';

const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '');

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          FindUr<span>Job</span>
        </div>
        <NavLink to="/offres" className={navClass}>
          Offres
        </NavLink>
        <NavLink to="/candidatures" className={navClass}>
          Candidatures
        </NavLink>
        <NavLink to="/historique" className={navClass}>
          Historique
        </NavLink>
        <NavLink to="/preferences" className={navClass}>
          Préférences
        </NavLink>
        <NavLink to="/mon-cv" className={navClass}>
          Mon CV
        </NavLink>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/offres" replace />} />
          <Route path="/offres" element={<OffersPage />} />
          <Route path="/candidatures" element={<ApplicationsPage />} />
          <Route path="/historique" element={<HistoryPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/mon-cv" element={<CvBuilderPage />} />
          {/* Ancienne adresse du profil : on redirige plutôt que de casser un signet. */}
          <Route path="/profil" element={<Navigate to="/mon-cv" replace />} />
        </Routes>
      </main>
    </div>
  );
}
