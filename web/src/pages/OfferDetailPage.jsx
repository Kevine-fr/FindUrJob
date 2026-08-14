import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS, SENDABLE_SOURCES } from '../lib/status.js';
import { useToast } from '../components/Toast.jsx';
import { ilYA, fraicheur, candidats, concurrence } from '../lib/freshness.js';

export default function OfferDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [offer, setOffer] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOffer(null);
    setError(null);
    api.offers.get(id).then(setOffer).catch((err) => setError(err.message));
  }, [id]);

  const follow = async () => {
    setBusy(true);
    try {
      await toast.promise(api.applications.create({ offer: offer._id, status: 'brouillon' }), {
        loading: 'Ajout à tes candidatures…',
        success: `« ${offer.title} » suivie.`,
        error: (err) => `Impossible de suivre cette offre : ${err.message}`,
      });
      navigate('/candidatures');
    } catch {
      /* déjà signalé par le toast */
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="empty">
        <strong>Offre introuvable</strong>
        {error}
        <br />
        <Link className="btn btn-sm" to="/offres" style={{ marginTop: 14 }}>
          ← Retour aux offres
        </Link>
      </div>
    );
  }

  if (!offer) {
    return (
      <>
        <div className="skeleton skeleton-line" style={{ width: '45%', height: 30 }} />
        <div className="detail" style={{ marginTop: 22 }}>
          <div className="skeleton" style={{ height: 420 }} />
          <div className="skeleton" style={{ height: 240 }} />
        </div>
      </>
    );
  }

  const canApply = SENDABLE_SOURCES.includes(offer.source);

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link className="back-link" to="/offres">
            ← Toutes les offres
          </Link>
          <h1 style={{ marginTop: 8 }}>{offer.title}</h1>
          <p style={{ marginTop: 8 }}>
            <strong>{offer.company || 'Entreprise non précisée'}</strong>
            {offer.location ? ` · ${offer.location}` : ''}
          </p>
        </div>
      </div>

      <div className="detail">
        <div className="panel">
          <h2>Descriptif</h2>
          {offer.description ? (
            <div className="prose">{offer.description}</div>
          ) : (
            <p className="muted">
              Cette source ne fournit pas le détail de l'annonce. Ouvre-la sur la plateforme pour
              la lire en entier.
            </p>
          )}
        </div>

        <div>
          <div className="panel">
            <h2>En bref</h2>
            <dl className="facts">
              <div>
                <dt>Plateforme</dt>
                <dd>
                  <span className="chip chip-accent">
                    {SOURCE_LABELS[offer.source] || offer.source}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Contrat</dt>
                <dd>{CONTRACT_LABELS[offer.contractType] || offer.contractType}</dd>
              </div>
              <div>
                <dt>Télétravail</dt>
                <dd>{REMOTE_LABELS[offer.remote] || offer.remote}</dd>
              </div>
              {offer.salary && (
                <div>
                  <dt>Rémunération</dt>
                  <dd>{offer.salary}</dd>
                </div>
              )}
              {/* Les deux signaux décisifs, en tête des repères. */}
              <div>
                <dt>Publiée</dt>
                <dd className={`signal signal-${fraicheur(offer.publishedAt)}`}>
                  {ilYA(offer.publishedAt) || 'date inconnue'}
                </dd>
              </div>
              <div>
                <dt>Candidats</dt>
                <dd className={`signal signal-${concurrence(offer.applicantCount)}`}>
                  {candidats(offer.applicantCount) || 'non communiqué'}
                </dd>
              </div>
              <div>
                <dt>Repérée le</dt>
                <dd>{new Date(offer.createdAt).toLocaleDateString('fr-FR')}</dd>
              </div>
            </dl>

            {offer.keywords?.length > 0 && (
              <>
                <div className="section-label">Mots-clés</div>
                <div className="filter-chips">
                  {offer.keywords.map((word) => (
                    <span key={word} className="chip">
                      {word}
                    </span>
                  ))}
                </div>
              </>
            )}

            <div className="stack" style={{ marginTop: 18 }}>
              <button
                className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`}
                onClick={follow}
                disabled={busy}
              >
                Suivre cette offre
              </button>
              {offer.sourceUrl && (
                <a
                  className="btn btn-block"
                  href={offer.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Voir l'annonce d'origine ↗
                </a>
              )}
            </div>

            {canApply && (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
                Une session {SOURCE_LABELS[offer.source]} ouverte permet de candidater sans quitter
                FindUrJob — voir l'onglet <Link to="/comptes">Comptes</Link>.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
