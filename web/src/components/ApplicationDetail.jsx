import { useState } from 'react';
import { api, API_BASE } from '../api/client.js';
import { STATUS_META, STATUS_ORDER, SOURCE_LABELS } from '../lib/status.js';
import { useToast } from './Toast.jsx';
import { ilYA, fraicheur, candidats, concurrence } from '../lib/freshness.js';

export default function ApplicationDetail({ application, onBack, onChange }) {
  const toast = useToast();
  const [app, setApp] = useState(application);
  const [busy, setBusy] = useState(false);
  const [vue, setVue] = useState('cv'); // cv | lettre — sur petit écran surtout
  const meta = STATUS_META[app.status] || { label: app.status, color: '#62667a' };

  const cvId = app.cvVersion?._id;
  const pdfUrl = cvId ? `${API_BASE}/cv-versions/${cvId}/pdf` : null;

  const changeStatus = async (status) => {
    if (status === app.status) return;
    setBusy(true);
    try {
      const updated = await api.applications.setStatus(app._id, status);
      setApp(updated);
      onChange?.(updated);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tailor = async () => {
    setBusy(true);
    try {
      const updated = await toast.promise(api.applications.tailor(app._id), {
        loading: 'Génération du CV ciblé…',
        success: 'CV ciblé régénéré.',
        error: (err) => `Génération impossible : ${err.message}`,
      });
      setApp(updated);
      onChange?.(updated);
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(false);
    }
  };

  const timeline = [...(app.timeline || [])].reverse();

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <button className="back-link" onClick={onBack}>
            ← Toutes les candidatures
          </button>
          <h1 style={{ marginTop: 8 }}>{app.offer?.title || 'Offre'}</h1>
          <p style={{ marginTop: 6 }}>
            <strong>{app.offer?.company || '—'}</strong>
            {app.offer?.location ? ` · ${app.offer.location}` : ''}
          </p>
        </div>
        <span className="badge dot" style={{ color: meta.color, borderColor: `${meta.color}33` }}>
          {meta.label}
        </span>
      </div>

      <div className="detail">
        {/* ---- Le dossier envoyé ---- */}
        <div className="panel dossier">
          <div className="dossier-head">
            <h2>Dossier de candidature</h2>
            <div className="inline">
              <button
                className={`filter-chip${vue === 'cv' ? ' active' : ''}`}
                onClick={() => setVue('cv')}
              >
                CV
              </button>
              <button
                className={`filter-chip${vue === 'lettre' ? ' active' : ''}`}
                onClick={() => setVue('lettre')}
              >
                Lettre
              </button>
            </div>
          </div>

          {vue === 'cv' ? (
            app.cvVersion ? (
              <>
                <div className="dossier-actions">
                  <div className="muted" style={{ fontSize: 13, minWidth: 0 }}>
                    {app.cvVersion.label}
                    {typeof app.cvVersion.score === 'number' && ` · score ${app.cvVersion.score}%`}
                  </div>
                  <div className="inline">
                    <a className="btn btn-sm" href={pdfUrl} target="_blank" rel="noreferrer">
                      Ouvrir ↗
                    </a>
                    <a className="btn btn-primary btn-sm" href={`${pdfUrl}?download=1`}>
                      Télécharger
                    </a>
                  </div>
                </div>

                {/* Le PDF réellement joint : ce que le recruteur a reçu, pas une
                    reconstruction depuis le profil actuel. */}
                <div className="pdf-frame">
                  <iframe src={pdfUrl} title="CV envoyé" />
                </div>

                <details className="cv-source">
                  <summary>Voir le texte du CV</summary>
                  <pre className="cv-preview">{app.cvVersion.content}</pre>
                </details>
              </>
            ) : (
              <div className="empty" style={{ padding: '32px 16px' }}>
                <strong>Aucun CV ciblé</strong>
                Génère-le pour cette offre : le moteur reprend ton CV de base et le réécrit selon
                l'annonce.
              </div>
            )
          ) : app.coverLetter ? (
            <pre className="cv-preview" style={{ maxHeight: 'none' }}>
              {app.coverLetter}
            </pre>
          ) : (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <strong>Aucune lettre</strong>
              Elle est rédigée en même temps que le CV ciblé.
            </div>
          )}

          <button
            className={`btn btn-primary${busy ? ' is-busy' : ''}`}
            onClick={tailor}
            disabled={busy}
            style={{ marginTop: 14 }}
          >
            {app.cvVersion ? 'Régénérer le CV ciblé' : 'Générer le CV ciblé'}
          </button>
        </div>

        {/* ---- Suivi ---- */}
        <div>
          <div className="panel">
            <h2>Statut</h2>
            <div className="filter-chips">
              {STATUS_ORDER.map((status) => {
                const info = STATUS_META[status];
                const actif = status === app.status;
                return (
                  <button
                    key={status}
                    className={`filter-chip${actif ? ' active' : ''}`}
                    onClick={() => changeStatus(status)}
                    disabled={busy}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>

            <div className="section-label">Repères</div>
            <dl className="facts">
              {app.offer?.source && (
                <div>
                  <dt>Plateforme</dt>
                  <dd>
                    <span className="chip chip-accent">
                      {SOURCE_LABELS[app.offer.source] || app.offer.source}
                    </span>
                  </dd>
                </div>
              )}
              {typeof app.matchScore === 'number' && (
                <div>
                  <dt>Correspondance</dt>
                  <dd>{app.matchScore}%</dd>
                </div>
              )}
              <div>
                <dt>Offre publiée</dt>
                <dd className={`signal signal-${fraicheur(app.offer?.publishedAt)}`}>
                  {ilYA(app.offer?.publishedAt) || 'date inconnue'}
                </dd>
              </div>
              <div>
                <dt>Candidats</dt>
                <dd className={`signal signal-${concurrence(app.offer?.applicantCount)}`}>
                  {candidats(app.offer?.applicantCount) || 'non communiqué'}
                </dd>
              </div>
              {app.appliedAt && (
                <div>
                  <dt>Envoyée le</dt>
                  <dd>{new Date(app.appliedAt).toLocaleDateString('fr-FR')}</dd>
                </div>
              )}
              <div>
                <dt>Mise à jour</dt>
                <dd>{new Date(app.updatedAt).toLocaleDateString('fr-FR')}</dd>
              </div>
            </dl>

            {app.offer?.sourceUrl && (
              <a
                className="btn btn-sm btn-block"
                href={app.offer.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ marginTop: 12 }}
              >
                Voir l'annonce ↗
              </a>
            )}
          </div>

          <div className="panel">
            <h2>Historique</h2>
            <div className="timeline">
              {timeline.length === 0 ? (
                <p className="muted">Aucun évènement.</p>
              ) : (
                timeline.map((entry, index) => {
                  const info = STATUS_META[entry.status] || { label: entry.status };
                  return (
                    <div className="tl-item" key={index} style={{ '--i': index }}>
                      <div className="tl-status">{info.label}</div>
                      <div className="tl-meta">
                        {new Date(entry.at || app.updatedAt).toLocaleString('fr-FR')}
                        {entry.note ? ` — ${entry.note}` : ''}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {app.notes && (
            <div className="panel">
              <h2>Notes</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                {app.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
