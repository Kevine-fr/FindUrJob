import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { STATUS_META } from '../lib/status.js';
import { ilYA, fraicheur, candidats, concurrence } from '../lib/freshness.js';
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
      .then((list) => {
        setApps(list);
        setError(null);
      })
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
        <div className="grid grid-cards">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : error ? (
        <div className="empty">
          <strong>Candidatures indisponibles</strong>
          {error}
        </div>
      ) : apps.length === 0 ? (
        <div className="empty">
          <strong>Aucune candidature</strong>
          Va dans « Offres » et clique sur « Suivre cette offre ».
        </div>
      ) : (
        <div className="grid grid-cards stagger">
          {apps.map((a, index) => {
            const meta = STATUS_META[a.status] || { label: a.status, color: '#62667a' };
            return (
              <div
                key={a._id}
                className="card clickable"
                style={{ '--i': index % 12 }}
                onClick={() => setSelected(a)}
              >
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

                {/* Une annonce qui vieillit pendant qu'on hésite : c'est
                    l'information qui dit s'il faut relancer ou passer. */}
                <div className="signals">
                  <span className={`signal signal-${fraicheur(a.offer?.publishedAt)}`}>
                    {ilYA(a.offer?.publishedAt) || 'date inconnue'}
                  </span>
                  {candidats(a.offer?.applicantCount) && (
                    <span className={`signal signal-${concurrence(a.offer?.applicantCount)}`}>
                      {candidats(a.offer.applicantCount)}
                    </span>
                  )}
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
