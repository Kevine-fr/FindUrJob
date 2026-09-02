import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS, STATUS_META } from '../lib/status.js';
import { Stat, AreaChart, BarList, Donut, SERIES } from '../components/Charts.jsx';
import UserActivityPanel from '../components/UserActivityPanel.jsx';

const PERIODES = [
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
];

const libellesStatut = Object.fromEntries(
  Object.entries(STATUS_META).map(([cle, meta]) => [cle, meta.label])
);

export default function AdminPage() {
  const toast = useToast();
  const { user } = useAuth();

  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  // Compte dont on regarde la fiche. `null` = on est sur le tableau de bord.
  const [profil, setProfil] = useState(null);

  const load = useCallback(() => {
    Promise.all([api.admin.overview(days), api.admin.users()])
      .then(([apercu, comptes]) => {
        setData(apercu);
        setUsers(comptes.users);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [days]);

  useEffect(load, [load]);

  const agir = async (id, action, corps) => {
    setBusy(id);
    try {
      await toast.promise(action, {
        loading: 'Application…',
        success: corps,
        error: (err) => err.message,
      });
      load();
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(null);
    }
  };

  /*
   * La fiche d'un compte remplace la console plutôt que de s'ouvrir par-dessus.
   *
   * Elle porte ses propres filtres — période, familles, recherche — et un
   * tiroir superposé mettrait deux jeux de filtres à l'écran en même temps,
   * sans dire lequel agit sur quoi.
   */
  if (profil) {
    return <UserActivityPanel userId={profil} onClose={() => setProfil(null)} />;
  }

  if (error) {
    return (
      <div className="empty">
        <strong>Console indisponible</strong>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <>
        <div className="skeleton skeleton-line" style={{ width: '30%', height: 28 }} />
        <div className="grid grid-cards" style={{ marginTop: 20 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
        <div className="skeleton skeleton-card" style={{ marginTop: 16, height: 260 }} />
      </>
    );
  }

  const { totaux, series, repartitions } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Console d'administration</h1>
          <p>
            L'activité de l'installation, tous comptes confondus. Les données de chacun restent
            cloisonnées : cette page en donne les volumes, pas le contenu.
          </p>
        </div>
        <div className="filter-chips">
          {PERIODES.map((p) => (
            <button
              key={p.days}
              className={`filter-chip${days === p.days ? ' active' : ''}`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Chiffres clés ---- */}
      <div className="stats stagger">
        <Stat label="Comptes" value={totaux.utilisateurs} hint={`${totaux.actifs} actif(s)`} />
        <Stat label="Offres collectées" value={totaux.offres} />
        <Stat
          label="Candidatures"
          value={totaux.candidatures}
          hint={`${totaux.envoyees} envoyée(s)`}
        />
        <Stat label="Taux d'envoi" value={totaux.tauxEnvoi} suffix=" %" tone={totaux.tauxEnvoi >= 50 ? 'ok' : undefined} />
        <Stat label="Entretiens" value={totaux.entretiens} tone="ok" />
        <Stat
          label="Score moyen"
          value={totaux.scoreMoyen ?? 0}
          suffix=" %"
          hint="correspondance offre / profil"
        />
        <Stat label="Campagnes actives" value={totaux.campagnesActives} />
        <Stat label="Sessions ouvertes" value={totaux.sessionsOuvertes} hint="plateformes connectées" />
        <Stat label="CV générés" value={totaux.cvs} hint={`${totaux.pdfMo} Mo de PDF`} />
      </div>

      {/* ---- Séries temporelles ---- */}
      <div className="grid admin-grid">
        <div className="panel">
          <h2>Candidatures par jour</h2>
          <AreaChart data={series.candidatures} label="candidatures" color={SERIES[0]} />
        </div>
        <div className="panel">
          <h2>Offres collectées par jour</h2>
          <AreaChart data={series.offres} label="offres" color={SERIES[2]} />
        </div>
        <div className="panel">
          <h2>Inscriptions par jour</h2>
          <AreaChart data={series.inscriptions} label="inscriptions" color={SERIES[4]} />
        </div>
      </div>

      {/* ---- Répartitions ---- */}
      <div className="grid admin-grid">
        <div className="panel">
          <h2>Offres par plateforme</h2>
          <Donut data={repartitions.source} labels={SOURCE_LABELS} />
        </div>
        <div className="panel">
          <h2>Candidatures par statut</h2>
          <BarList data={repartitions.statut} labels={libellesStatut} color={SERIES[1]} />
        </div>
        <div className="panel">
          <h2>Types de contrat</h2>
          <BarList data={repartitions.contrat} labels={CONTRACT_LABELS} color={SERIES[2]} />
        </div>
        <div className="panel">
          <h2>Télétravail</h2>
          <BarList data={repartitions.teletravail} labels={REMOTE_LABELS} color={SERIES[5]} />
        </div>

        {/* Un vivier majoritairement ancien explique un faible taux de réponse
            mieux que n'importe quelle autre métrique. */}
        <div className="panel">
          <h2>Fraîcheur du vivier</h2>
          <BarList data={repartitions.fraicheur || []} color={SERIES[3]} />
        </div>
      </div>

      {/* ---- Comptes ---- */}
      <div className="panel">
        <h2>Comptes ({users?.length || 0})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Compte</th>
                <th>Rôle</th>
                <th className="num">Offres</th>
                <th className="num">Candid.</th>
                <th className="num">Envoyées</th>
                <th className="num">CV</th>
                <th>Dernière visite</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(users || []).map((compte) => {
                const soi = compte.id === user.id;
                return (
                  <tr key={compte.id} className={compte.active ? '' : 'is-off'}>
                    <td>
                      <div className="cell-user">
                        <span className="nav-avatar">
                          {(compte.fullName || compte.email).charAt(0).toUpperCase()}
                        </span>
                        {/* Le nom ouvre la fiche : c'est là qu'on clique
                            d'instinct pour « en savoir plus sur ce compte ». */}
                        <button
                          className="cell-user-link"
                          onClick={() => setProfil(compte.id)}
                          title="Voir l'activité de ce compte"
                        >
                          <strong>{compte.fullName || compte.email}</strong>
                          {compte.fullName && <em>{compte.email}</em>}
                        </button>
                        {compte.stats.campagneActive && (
                          <span className="badge badge-send">campagne</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`state state-${compte.role === 'admin' ? 'connectee' : 'absente'}`}>
                        {compte.role === 'admin' ? 'admin' : 'membre'}
                      </span>
                      {!compte.active && <span className="state state-erreur">désactivé</span>}
                    </td>
                    <td className="num">{compte.stats.offres.toLocaleString('fr-FR')}</td>
                    <td className="num">{compte.stats.candidatures.toLocaleString('fr-FR')}</td>
                    <td className="num">{compte.stats.envoyees.toLocaleString('fr-FR')}</td>
                    <td className="num">{compte.stats.cvs.toLocaleString('fr-FR')}</td>
                    <td className="muted">
                      {compte.lastLoginAt
                        ? new Date(compte.lastLoginAt).toLocaleDateString('fr-FR')
                        : '—'}
                    </td>
                    <td>
                      <div className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {/* Consulter l'activité vaut pour tout compte, le sien
                            compris — contrairement aux actions de droits. */}
                        <button className="btn btn-ghost btn-sm" onClick={() => setProfil(compte.id)}>
                          Activité
                        </button>
                      </div>
                      {/* On ne se retire pas ses propres droits : l'API le refuse
                          aussi, mais l'interface ne doit pas le proposer. */}
                      {!soi && (
                        <div className="inline" style={{ gap: 6, flexWrap: 'nowrap', marginTop: 6 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busy === compte.id}
                            onClick={() =>
                              agir(
                                compte.id,
                                api.admin.updateUser(compte.id, {
                                  role: compte.role === 'admin' ? 'user' : 'admin',
                                }),
                                compte.role === 'admin' ? 'Droits retirés.' : 'Passé administrateur.'
                              )
                            }
                          >
                            {compte.role === 'admin' ? 'Rétrograder' : 'Promouvoir'}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busy === compte.id}
                            onClick={() =>
                              agir(
                                compte.id,
                                api.admin.updateUser(compte.id, { active: !compte.active }),
                                compte.active ? 'Compte désactivé.' : 'Compte réactivé.'
                              )
                            }
                          >
                            {compte.active ? 'Désactiver' : 'Réactiver'}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busy === compte.id}
                            onClick={() => {
                              const sur = window.confirm(
                                `Supprimer ${compte.email} ?\n\n` +
                                  `${compte.stats.offres} offre(s), ${compte.stats.candidatures} candidature(s) ` +
                                  `et ${compte.stats.cvs} CV seront effacés définitivement.`
                              );
                              if (sur) {
                                agir(compte.id, api.admin.deleteUser(compte.id), 'Compte supprimé.');
                              }
                            }}
                          >
                            Supprimer
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
