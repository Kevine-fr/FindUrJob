import { useState } from 'react';
import { api } from '../api/client.js';
import { STATUS_META, STATUS_ORDER } from '../lib/status.js';

export default function ApplicationDetail({ application, onBack, onChange }) {
  const [app, setApp] = useState(application);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meta = STATUS_META[app.status] || { label: app.status, color: '#62667a' };

  const changeStatus = async (status) => {
    if (status === app.status) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.applications.setStatus(app._id, status);
      setApp(updated);
      onChange?.(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tailor = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.applications.tailor(app._id);
      setApp(updated);
      onChange?.(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const timeline = [...(app.timeline || [])].reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            ← Retour
          </button>
          <h1 style={{ marginTop: 8 }}>{app.offer?.title || 'Offre'}</h1>
          <p>
            {app.offer?.company || '—'} · {app.offer?.location || '—'}
          </p>
        </div>
        <span className="badge dot" style={{ color: meta.color, borderColor: meta.color + '33' }}>
          {meta.label}
        </span>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="detail">
        <div className="panel">
          <h2>Changer le statut</h2>
          <div className="row">
            {STATUS_ORDER.map((s) => {
              const m = STATUS_META[s];
              const active = s === app.status;
              return (
                <button
                  key={s}
                  disabled={busy}
                  className={'btn btn-sm' + (active ? ' btn-primary' : '')}
                  onClick={() => changeStatus(s)}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="section-label">Historique</div>
          <div className="timeline">
            {timeline.length === 0 ? (
              <p className="muted">Aucun évènement.</p>
            ) : (
              timeline.map((t, i) => {
                const m = STATUS_META[t.status] || { label: t.status };
                return (
                  <div className="tl-item" key={i}>
                    <div className="tl-status">{m.label}</div>
                    <div className="tl-meta">
                      {new Date(t.at).toLocaleString('fr-FR')}
                      {t.note ? ` — ${t.note}` : ''}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="panel">
          <h2>CV ciblé & lettre</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Génère une version du CV adaptée à cette offre. (Brouillon tant que le moteur IA n'est
            pas branché.)
          </p>
          <button className="btn btn-primary" onClick={tailor} disabled={busy}>
            {busy ? '…' : app.cvVersion ? 'Régénérer le CV ciblé' : 'Générer le CV ciblé'}
          </button>

          {app.cvVersion && (
            <>
              <div className="section-label">CV — {app.cvVersion.label}</div>
              <pre className="cv-preview">{app.cvVersion.content}</pre>
            </>
          )}
          {app.coverLetter && (
            <>
              <div className="section-label">Lettre de motivation</div>
              <pre className="cv-preview">{app.coverLetter}</pre>
            </>
          )}
        </div>
      </div>
    </>
  );
}
