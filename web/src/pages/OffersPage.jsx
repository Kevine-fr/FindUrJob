import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS } from '../lib/status.js';
import AddOfferForm from '../components/AddOfferForm.jsx';
import OfferFilters, { EMPTY_FILTERS, toQuery } from '../components/OfferFilters.jsx';

export default function OffersPage() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.offers
      .list(toQuery(filters))
      .then(setOffers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  // Le champ texte se tape lettre par lettre : on attend une courte pause.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  // Va chercher de vraies offres sur les sources configurées, avec les filtres
  // affichés comme critères (à défaut, les préférences enregistrées).
  const syncOffers = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const body = {};
      if (filters.q) body.keywords = filters.q.split(/\s+/).filter(Boolean);
      if (filters.location) body.location = filters.location;
      if (filters.contractType.length) body.contractTypes = filters.contractType;
      if (filters.remote.length) body.remotes = filters.remote;
      if (filters.source.length) body.sources = filters.source;

      const result = await api.offers.sync(body);
      const detail = Object.entries(result.sources || {})
        .map(([name, status]) => `${name} : ${status}`)
        .join(' · ');
      setNotice(
        `${result.imported} nouvelle${result.imported > 1 ? 's' : ''} offre${
          result.imported > 1 ? 's' : ''
        }, ${result.updated} mise${result.updated > 1 ? 's' : ''} à jour` +
          (result.skipped ? `, ${result.skipped} écartée(s)` : '') +
          (detail ? ` — ${detail}` : '')
      );
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const applyPreferences = async () => {
    setError(null);
    try {
      const prefs = await api.preferences.get();
      setFilters({
        ...EMPTY_FILTERS,
        q: (prefs.keywords || []).join(' ').trim(),
        location: (prefs.locations || [])[0] || '',
        contractType: prefs.contractTypes || [],
        remote: prefs.remotes || [],
        source: prefs.sources || [],
      });
    } catch (e) {
      setError(e.message);
    }
  };

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
            Cherche sur les plateformes branchées, ou saisis une offre à la main. Les critères
            ci-dessous servent aussi à la recherche.
          </p>
        </div>
        <div className="inline">
          <button className="btn btn-primary" onClick={syncOffers} disabled={syncing}>
            {syncing ? 'Recherche en cours…' : '⟳ Chercher des offres'}
          </button>
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Fermer' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {showForm && (
        <AddOfferForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <OfferFilters
        filters={filters}
        onChange={setFilters}
        onApplyPreferences={applyPreferences}
        resultCount={offers.length}
      />

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
        <div className="empty">
          Aucune offre ne correspond. Élargis les filtres, ou ajoute une offre ✦
        </div>
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
