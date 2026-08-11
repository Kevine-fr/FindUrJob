import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import OffersPage from './pages/OffersPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '');

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Fil<span>o</span>
        </div>
        <NavLink to="/offres" className={navClass}>
          Offres
        </NavLink>
        <NavLink to="/candidatures" className={navClass}>
          Candidatures
        </NavLink>
        <NavLink to="/profil" className={navClass}>
          Profil
        </NavLink>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/offres" replace />} />
          <Route path="/offres" element={<OffersPage />} />
          <Route path="/candidatures" element={<ApplicationsPage />} />
          <Route path="/profil" element={<ProfilePage />} />
        </Routes>
      </main>
    </div>
  );
}
