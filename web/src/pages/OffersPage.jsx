import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS } from '../lib/status.js';
import { ilYA, fraicheur, candidats, concurrence } from '../lib/freshness.js';
import { useToast } from '../components/Toast.jsx';
import AddOfferForm from '../components/AddOfferForm.jsx';
import OfferFilters, { EMPTY_FILTERS, toQuery } from '../components/OfferFilters.jsx';

export default function OffersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState({ offers: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [followed, setFollowed] = useState(() => new Set());

  const load = useCallback(() => {
    setLoading(true);
    const query = toQuery(filters);
    api.offers
      .list(`${query}${query ? '&' : '?'}page=${page}`)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters, page]);

  // Le champ texte se tape lettre par lettre : on attend une courte pause.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  // Changer un filtre repart de la première page : rester en page 4 d'un
  // résultat qui n'en compte plus qu'une donne une liste vide trompeuse.
  useEffect(() => setPage(1), [filters]);

  /**
   * Va chercher de vraies offres sur toutes les sources branchées : les API via
   * le moteur Python, LinkedIn/Indeed/HelloWork via le navigateur piloté.
   */
  const syncOffers = async () => {
    setSyncing(true);
    const body = { limit: 60 };
    if (filters.q) body.keywords = filters.q.split(/\s+/).filter(Boolean);
    if (filters.location) body.location = filters.location;
    if (filters.contractType.length) body.contractTypes = filters.contractType;
    if (filters.remote.length) body.remotes = filters.remote;
    if (filters.source.length) body.sources = filters.source;

    try {
      const result = await toast.promise(api.offers.sync(body), {
        loading: 'Recherche sur les plateformes…',
        success: (res) =>
          `${res.imported} nouvelle(s), ${res.updated} mise(s) à jour` +
          (res.skipped ? `, ${res.skipped} écartée(s)` : ''),
        error: (err) => `Recherche interrompue : ${err.message}`,
      });

      // Le détail par source mérite son propre message : c'est là qu'on voit
      // qu'une plateforme a échoué alors que les autres ont répondu.
      const failures = Object.entries(result.sources || {}).filter(([, status]) =>
        String(status).startsWith('échec')
      );
      if (failures.length) {
        toast.info(failures.map(([name, status]) => `${name} : ${status}`).join(' · '), {
          title: 'Sources en échec',
          duration: 10000,
        });
      }

      setPage(1);
      load();
    } catch {
      /* déjà signalé par le toast */
    } finally {
      setSyncing(false);
    }
  };

  const applyPreferences = async () => {
    try {
      const prefs = await api.preferences.get();
      setFilters({
        ...EMPTY_FILTERS,
        q: (prefs.keywords || []).join(' ').trim(),
        location: (prefs.locations || [])[0] || '',
        contractType: prefs.contractTypes || [],
        remote: prefs.remotes || [],
        source: prefs.sources || [],
        // Les critères de fraîcheur et de concurrence viennent aussi des
        // préférences : on ne les repose pas à chaque recherche.
        publishedWithin: prefs.maxAgeValue || '',
        publishedUnit: prefs.maxAgeUnit || 'jour',
        maxApplicants: prefs.maxApplicants ?? '',
      });
      toast.success('Filtres alignés sur tes préférences.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const follow = async (offer) => {
    try {
      await api.applications.create({ offer: offer._id, status: 'brouillon' });
      setFollowed((current) => new Set(current).add(offer._id));
      toast.success(`« ${offer.title} » ajoutée à tes candidatures.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const { offers, total, pages } = data;

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
          <button
            className={`btn btn-primary${syncing ? ' is-busy' : ''}`}
            onClick={syncOffers}
            disabled={syncing}
          >
            ⟳ Chercher des offres
          </button>
          <button className="btn" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Fermer' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {showForm && (
        <AddOfferForm
          onCreated={() => {
            setShowForm(false);
            toast.success('Offre ajoutée.');
            load();
          }}
        />
      )}

      <OfferFilters
        filters={filters}
        onChange={setFilters}
        onApplyPreferences={applyPreferences}
        resultCount={total}
      />

      {loading ? (
        <div className="grid grid-cards">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : error ? (
        <div className="empty">
          <strong>Impossible de charger les offres</strong>
          {error}
          <br />
          <span className="muted">L'API tourne-t-elle ? (docker compose up)</span>
        </div>
      ) : offers.length === 0 ? (
        <div className="empty">
          <strong>Aucune offre ne correspond</strong>
          Élargis les filtres, lance une recherche, ou ajoute une offre à la main.
        </div>
      ) : (
        <>
          <div className="grid grid-cards stagger">
            {offers.map((offer, index) => (
              <div
                key={offer._id}
                className="card offer-card clickable"
                style={{ '--i': index % 12 }}
                onClick={() => navigate(`/offres/${offer._id}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') navigate(`/offres/${offer._id}`);
                }}
              >
                <h3>{offer.title}</h3>
                <div className="meta">
                  {offer.company || 'Entreprise ?'} · {offer.location || 'Lieu ?'}
                </div>

                {/* Fraîcheur et concurrence : les deux signaux qui décident s'il
                    vaut la peine de postuler — donc avant le reste. */}
                <div className="signals">
                  <span className={`signal signal-${fraicheur(offer.publishedAt)}`}>
                    {ilYA(offer.publishedAt) || 'date inconnue'}
                  </span>
                  {candidats(offer.applicantCount) && (
                    <span className={`signal signal-${concurrence(offer.applicantCount)}`}>
                      {candidats(offer.applicantCount)}
                    </span>
                  )}
                </div>
                <div className="row">
                  <span className="chip chip-accent">
                    {SOURCE_LABELS[offer.source] || offer.source}
                  </span>
                  <span className="chip">
                    {CONTRACT_LABELS[offer.contractType] || offer.contractType}
                  </span>
                  <span className="chip">{REMOTE_LABELS[offer.remote] || offer.remote}</span>
                  {offer.salary && <span className="chip">{offer.salary}</span>}
                </div>
                {/* La carte entière est cliquable : les actions doivent retenir
                    le clic, sinon « Suivre » ouvrirait aussi le détail. */}
                <div className="row" onClick={(event) => event.stopPropagation()}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => follow(offer)}
                    disabled={followed.has(offer._id)}
                  >
                    {followed.has(offer._id) ? '✓ Suivie' : 'Suivre cette offre'}
                  </button>
                  {offer.sourceUrl && (
                    <a
                      className="btn btn-sm"
                      href={offer.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Voir l'offre ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {pages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button
                className="btn btn-sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
              >
                ← Précédent
              </button>
              <span className="pager-info">
                Page {page} sur {pages} — {total} offres
              </span>
              <button
                className="btn btn-sm"
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
                disabled={page >= pages}
              >
                Suivant →
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
