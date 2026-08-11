import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { STATUS_META } from '../lib/status.js';
import ApplicationDetail from '../components/ApplicationDetail.jsx';

export default function ApplicationsPage() {
  const [apps, setApps] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api.applications
      .list()
      .then(setApps)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const refreshOne = (updated) => {
    setApps((list) => list.map((a) => (a._id === updated._id ? updated : a)));
    setSelected(updated);
  };

  if (selected) {
    return (
      <ApplicationDetail
        application={selected}
        onBack={() => setSelected(null)}
        onChange={refreshOne}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Candidatures</h1>
          <p>Le fil de tes candidatures — statut, historique et CV ciblé par offre.</p>
        </div>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : error ? (
        <div className="empty">Erreur : {error}</div>
      ) : apps.length === 0 ? (
        <div className="empty">
          Aucune candidature. Va dans « Offres » et clique sur « Suivre cette offre ».
        </div>
      ) : (
        <div className="grid grid-cards">
          {apps.map((a) => {
            const meta = STATUS_META[a.status] || { label: a.status, color: '#62667a' };
            return (
              <div key={a._id} className="card clickable" onClick={() => setSelected(a)}>
                <div className="inline">
                  <span
                    className="badge dot"
                    style={{ color: meta.color, borderColor: meta.color + '33' }}
                  >
                    {meta.label}
                  </span>
                  {typeof a.matchScore === 'number' && (
                    <span className="chip">Match {a.matchScore}%</span>
                  )}
                </div>
                <h3 style={{ marginTop: 10 }}>{a.offer?.title || 'Offre supprimée'}</h3>
                <div className="meta">
                  {a.offer?.company || '—'} · {a.offer?.location || '—'}
                </div>
                <div className="meta" style={{ marginTop: 8 }}>
                  Maj {new Date(a.updatedAt).toLocaleDateString('fr-FR')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
