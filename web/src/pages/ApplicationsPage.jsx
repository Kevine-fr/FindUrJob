import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { STATUS_META, STATUS_ORDER, SOURCE_LABELS } from '../lib/status.js';
import { ilYA, fraicheur, candidats, concurrence, UNITES } from '../lib/freshness.js';
import ApplicationDetail from '../components/ApplicationDetail.jsx';
import {
  SearchField,
  ChipGroup,
  FreshnessFilter,
  ApplicantsFilter,
  FilterFooter,
} from '../components/FilterBar.jsx';

const FILTRES_VIDES = {
  q: '',
  status: '',
  source: '',
  age: '',
  ageUnit: 'jour',
  maxApplicants: '',
};

export default function ApplicationsPage() {
  const [apps, setApps] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtres, setFiltres] = useState(FILTRES_VIDES);

  const set = (cle, valeur) => setFiltres((f) => ({ ...f, [cle]: valeur }));

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

  /*
   * Les campagnes tournent en arrière-plan : une candidature préparée il y a
   * dix secondes peut être partie depuis. Sans ce rafraîchissement, l'onglet
   * montrait un état figé au chargement de la page, et il fallait recharger
   * pour voir « postulé » apparaître.
   */
  useEffect(() => {
    if (selected) return undefined; // le détail a sa propre synchronisation
    const timer = setInterval(() => {
      api.applications
        .list()
        .then(setApps)
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(timer);
  }, [selected]);

  // Compteur par statut : savoir qu'une case est vide évite de cliquer dedans.
  const parStatut = useMemo(() => {
    const compte = {};
    for (const a of apps) compte[a.status] = (compte[a.status] || 0) + 1;
    return compte;
  }, [apps]);

  const visibles = useMemo(() => {
    const recherche = filtres.q.trim().toLowerCase();
    const unite = UNITES.find((u) => u.key === filtres.ageUnit);
    const limite = filtres.age && unite ? Date.now() - Number(filtres.age) * unite.ms : null;

    return apps.filter((a) => {
      if (filtres.status && a.status !== filtres.status) return false;
      if (filtres.source && a.offer?.source !== filtres.source) return false;

      if (limite) {
        // Sans date de publication, on ne peut pas affirmer que l'offre est
        // récente : on l'écarte plutôt que de la faire passer pour fraîche.
        if (!a.offer?.publishedAt) return false;
        if (new Date(a.offer.publishedAt).getTime() < limite) return false;
      }

      if (filtres.maxApplicants !== '') {
        const n = a.offer?.applicantCount;
        if (typeof n !== 'number' || n > Number(filtres.maxApplicants)) return false;
      }

      if (recherche) {
        const foin = [a.offer?.title, a.offer?.company, a.offer?.location, a.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!foin.includes(recherche)) return false;
      }

      return true;
    });
  }, [apps, filtres]);

  const filtreActif = JSON.stringify(filtres) !== JSON.stringify(FILTRES_VIDES);

  // Seules les plateformes réellement présentes méritent une pastille.
  const sources = useMemo(
    () =>
      [...new Set(apps.map((a) => a.offer?.source).filter(Boolean))].map((value) => ({
        value,
        label: SOURCE_LABELS[value] || value,
      })),
    [apps]
  );

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

      {apps.length > 0 && (
        <div className="panel filters">
          <SearchField
            value={filtres.q}
            onChange={(v) => set('q', v)}
            placeholder="Intitulé, entreprise, ville, note…"
          />

          <ChipGroup
            label="Statut"
            value={filtres.status}
            onChange={(v) => set('status', v)}
            options={STATUS_ORDER.filter((s) => parStatut[s]).map((s) => ({
              value: s,
              label: STATUS_META[s].label,
              color: STATUS_META[s].color,
              count: parStatut[s],
            }))}
          />

          {sources.length > 1 && (
            <ChipGroup
              label="Plateforme"
              value={filtres.source}
              onChange={(v) => set('source', v)}
              options={sources}
              allLabel="Toutes"
            />
          )}

          <FreshnessFilter
            value={filtres.age}
            unit={filtres.ageUnit}
            onChange={(age, ageUnit) => setFiltres((f) => ({ ...f, age, ageUnit }))}
          />

          <ApplicantsFilter
            value={filtres.maxApplicants}
            onChange={(v) => set('maxApplicants', v)}
          />

          <FilterFooter
            shown={visibles.length}
            total={apps.length}
            noun="candidature"
            active={filtreActif}
            onReset={() => setFiltres(FILTRES_VIDES)}
          />
        </div>
      )}

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
      ) : visibles.length === 0 ? (
        <div className="empty">
          <strong>Aucune candidature ne correspond</strong>
          Tes {apps.length} candidatures sont toujours là — ce sont les filtres qui les masquent.
        </div>
      ) : (
        <div className="grid grid-cards stagger">
          {visibles.map((a, index) => {
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
