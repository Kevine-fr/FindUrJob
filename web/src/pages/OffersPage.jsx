import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS } from '../lib/status.js';
import AddOfferForm from '../components/AddOfferForm.jsx';

export default function OffersPage() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () => {
    setLoading(true);
    api.offers
      .list()
      .then(setOffers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const follow = async (offer) => {
    setNotice(null);
    try {
      await api.applications.create({ offer: offer._id, status: 'brouillon' });
      setNotice(`« ${offer.title} » ajoutée à tes candidatures.`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Offres</h1>
          <p>
            Colle une URL d'offre ou saisis-la à la main. L'extraction automatique (IA) arrivera
            ensuite.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Fermer' : '+ Ajouter une offre'}
        </button>
      </div>

      {showForm && (
        <AddOfferForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {notice && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          {notice}
        </div>
      )}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : error ? (
        <div className="empty">
          Erreur : {error}
          <br />
          <span className="muted">L'API tourne-t-elle ? (docker compose up)</span>
        </div>
      ) : offers.length === 0 ? (
        <div className="empty">Aucune offre pour l'instant. Ajoute la première ✦</div>
      ) : (
        <div className="grid grid-cards">
          {offers.map((o) => (
            <div key={o._id} className="card">
              <h3>{o.title}</h3>
              <div className="meta">
                {o.company || 'Entreprise ?'} · {o.location || 'Lieu ?'}
              </div>
              <div className="row">
                <span className="chip">{SOURCE_LABELS[o.source] || o.source}</span>
                <span className="chip">{CONTRACT_LABELS[o.contractType] || o.contractType}</span>
                <span className="chip">{REMOTE_LABELS[o.remote] || o.remote}</span>
                {o.salary && <span className="chip">{o.salary}</span>}
              </div>
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => follow(o)}>
                  Suivre cette offre
                </button>
                {o.sourceUrl && (
                  <a
                    className="btn btn-sm"
                    href={o.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Voir l'offre
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
