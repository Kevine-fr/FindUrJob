import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  /*
   * La réponse du serveur, paginée.
   *
   * L'onglet demandait auparavant **toutes** les candidatures, offres et CV
   * joints — plusieurs mégaoctets à cinq cents candidatures, redemandés toutes
   * les vingt secondes par le rafraîchissement automatique. Le filtrage est
   * remonté au serveur du même coup : filtré ici, un statut ne se serait
   * appliqué qu'à la page affichée.
   */
  const [data, setData] = useState({
    applications: [],
    total: 0,
    page: 1,
    pages: 1,
    counts: {},
    sources: {},
  });
  const [page, setPage] = useState(1);
  /*
   * La candidature ouverte est dans l URL, pas dans un etat local.
   *
   * Sans cela elle n avait pas d adresse : le courriel d alerte ne pouvait
   * renvoyer que vers la liste entiere, a charge pour le lecteur de retrouver
   * lui-meme la ligne dont on venait de lui parler. Une candidature adressable
   * se partage, se met en favori, et le bouton Precedent du navigateur la
   * referme comme on s y attend.
   */
  const { id } = useParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  // Bilan du dernier rapprochement, affiche sous les filtres.
  const [verif, setVerif] = useState('');

  const set = (cle, valeur) => setFiltres((f) => ({ ...f, [cle]: valeur }));

  // Les filtres deviennent une requête : c'est le serveur qui trie et pagine.
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filtres.q.trim()) params.set('q', filtres.q.trim());
    if (filtres.status) params.set('status', filtres.status);
    if (filtres.source) params.set('source', filtres.source);
    if (filtres.age) {
      params.set('publishedWithin', filtres.age);
      params.set('publishedUnit', filtres.ageUnit);
    }
    if (filtres.maxApplicants !== '') params.set('maxApplicants', filtres.maxApplicants);
    return params.toString();
  }, [filtres]);

  const load = useCallback(() => {
    setLoading(true);
    api.applications
      .list(`?${query}${query ? '&' : ''}page=${page}`)
      .then((reponse) => {
        setData(reponse);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query, page]);

  useEffect(load, [load]);

  // Changer un filtre repart de la première page : rester en page 4 d'un
  // résultat qui n'en compte plus qu'une affichait un vide trompeur.
  useEffect(() => setPage(1), [query]);

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
        .list(`?${query}${query ? '&' : ''}page=${page}`)
        .then(setData)
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(timer);
  }, [selected, query, page]);

  /*
   * Compteurs et plateformes viennent du serveur, calculés sur l'ensemble
   * filtré et non sur la page. Les déduire de la page ferait tomber toutes les
   * autres pastilles à zéro au premier clic sur un statut.
   */
  const apps = data.applications;
  const parStatut = data.counts || {};

  const filtreActif = JSON.stringify(filtres) !== JSON.stringify(FILTRES_VIDES);

  // Seules les plateformes réellement présentes méritent une pastille.
  const sources = useMemo(
    () =>
      Object.entries(data.sources || {}).map(([value, count]) => ({
        value,
        label: SOURCE_LABELS[value] || value,
        count,
      })),
    [data.sources]
  );

  const refreshOne = (updated) => {
    setData((etat) => ({
      ...etat,
      applications: etat.applications.map((a) => (a._id === updated._id ? updated : a)),
    }));
    setSelected(updated);
  };

  /*
   * Arriver directement par l URL — depuis un courriel, par exemple — precede
   * le chargement de la liste : la candidature est alors demandee seule.
   */
  useEffect(() => {
    if (!id) {
      setSelected(null);
      return;
    }
    const connue = apps.find((a) => a._id === id);
    if (connue) {
      setSelected(connue);
      return;
    }
    api.applications
      .get(id)
      .then(setSelected)
      .catch(() => navigate('/candidatures', { replace: true }));
  }, [id, apps, navigate]);

  if (selected) {
    return (
      <ApplicationDetail
        application={selected}
        onBack={() => navigate('/candidatures')}
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
        {/* Le robot ne marque « Postulé » que s'il voit une confirmation, et une
            confirmation ne s'affiche pas toujours. Ce bouton va demander aux
            plateformes ce qu'elles ont réellement reçu. */}
        <button
          className="btn btn-sm"
          onClick={async () => {
            setVerif('Vérification auprès des plateformes…');
            try {
              const bilan = await api.applications.reconcile();
              setVerif(
                bilan.confirmed
                  ? `${bilan.confirmed} candidature${bilan.confirmed > 1 ? 's' : ''} confirmée${bilan.confirmed > 1 ? 's' : ''} sur ${bilan.examined} vérifiée${bilan.examined > 1 ? 's' : ''}.`
                  : `Aucune confirmation nouvelle sur ${bilan.examined || 0} vérifiée(s).`
              );
              load();
            } catch (e) {
              setVerif(`Échec : ${e.message}`);
            }
          }}
          disabled={Boolean(verif) && verif.endsWith('…')}
        >
          Vérifier auprès des plateformes
        </button>
      </div>

      {verif && <div className="map-notice">{verif}</div>}

      {(apps.length > 0 || filtreActif) && (
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
            shown={apps.length}
            total={data.total}
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
          <strong>{filtreActif ? 'Aucune candidature ne correspond' : 'Aucune candidature'}</strong>
          {filtreActif
            ? 'Ce sont les filtres qui les masquent — remets-les à zéro pour tout revoir.'
            : 'Va dans « Offres » et clique sur « Suivre cette offre ».'}
        </div>
      ) : (
        <>
        <div className="grid grid-cards stagger">
          {apps.map((a, index) => {
            const meta = STATUS_META[a.status] || { label: a.status, color: '#62667a' };
            return (
              <div
                key={a._id}
                className="card clickable"
                style={{ '--i': index % 12 }}
                onClick={() => navigate(`/candidatures/${a._id}`)}
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
                  {/* La plateforme décide où finir la candidature à la main :
                      elle vaut d'être lisible sans ouvrir la fiche. */}
                  {a.offer?.source && (
                    <span className="chip chip-source">
                      {SOURCE_LABELS[a.offer.source] || a.offer.source}
                    </span>
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
                {/* « Maj 14/08/2026 » demandait un calcul mental pour répondre
                    à la seule question qui compte : est-ce récent ? */}
                <div className="card-foot">
                  <span className="meta" title={new Date(a.updatedAt).toLocaleString('fr-FR')}>
                    {ilYA(a.updatedAt) || '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Même pied de page que l'onglet Offres : on ne réapprend pas à
            naviguer d'un onglet à l'autre. */}
        {data.pages > 1 && (
          <nav className="pager" aria-label="Pagination">
            <button
              className="btn btn-sm"
              onClick={() => setPage((valeur) => Math.max(1, valeur - 1))}
              disabled={page <= 1}
            >
              ← Précédent
            </button>
            <span className="pager-info">
              Page {page} sur {data.pages} — {data.total} candidatures
            </span>
            <button
              className="btn btn-sm"
              onClick={() => setPage((valeur) => Math.min(data.pages, valeur + 1))}
              disabled={page >= data.pages}
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
