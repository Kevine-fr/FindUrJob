import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import SlippyMap, { cadrer } from '../components/SlippyMap.jsx';
import { SearchField, ChipGroup, FilterFooter } from '../components/FilterBar.jsx';
import {
  SOURCE_LABELS,
  SOURCE_COLORS,
  CONTRACT_LABELS,
  REMOTE_LABELS,
} from '../lib/status.js';

const CONTRATS = Object.entries(CONTRACT_LABELS).map(([value, label]) => ({ value, label }));
const MODES = Object.entries(REMOTE_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Groupe les offres par point.
 *
 * Une adresse est résolue à la ville : les quarante annonces parisiennes
 * partagent exactement les mêmes coordonnées et se superposeraient en un seul
 * marqueur, les trente-neuf du dessous devenant inatteignables. On les réunit
 * donc explicitement, et le marqueur porte leur nombre.
 */
function grouper(offers) {
  const groupes = new Map();

  for (const offer of offers) {
    const cle = `${offer.lat.toFixed(4)},${offer.lon.toFixed(4)}`;
    let groupe = groupes.get(cle);
    if (!groupe) {
      groupe = { cle, lat: offer.lat, lon: offer.lon, offers: [], sources: {} };
      groupes.set(cle, groupe);
    }
    groupe.offers.push(offer);
    groupe.sources[offer.source] = (groupe.sources[offer.source] || 0) + 1;
  }

  return [...groupes.values()]
    .map((groupe) => ({
      ...groupe,
      // Le lieu tel qu'il est écrit sur la première annonce : plus parlant que
      // des coordonnées, et suffisamment juste puisqu'elles pointent au même
      // endroit.
      lieu: groupe.offers[0].location || 'Lieu inconnu',
      // La plateforme majoritaire donne sa couleur au marqueur.
      source: Object.entries(groupe.sources).sort((a, b) => b[1] - a[1])[0][0],
    }))
    // Les gros groupes d'abord dans le DOM, donc dessous : un marqueur isolé
    // reste cliquable même collé à une métropole.
    .sort((a, b) => b.offers.length - a.offers.length);
}

function dateCourte(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function MapPage() {
  const [data, setData] = useState({ offers: [], placed: 0, pending: 0, resolving: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [contractType, setContractType] = useState('');
  const [remote, setRemote] = useState('');

  const [view, setView] = useState({ lat: 46.6, lon: 2.4, zoom: 5 });
  const [selection, setSelection] = useState(null);
  // Le recadrage automatique ne joue qu'au premier chargement d'un jeu de
  // filtres : sinon chaque rafraîchissement de fond ramènerait la vue en
  // arrière, juste au moment où on vient de zoomer sur une ville.
  // `null` et non `''` : la chaîne vide est une requête valide (aucun filtre),
  // et le premier cadrage n'aurait jamais lieu.
  const cadreFait = useRef(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (source) params.set('source', source);
    if (contractType) params.set('contractType', contractType);
    if (remote) params.set('remote', remote);
    const chaine = params.toString();
    return chaine ? `?${chaine}` : '';
  }, [q, source, contractType, remote]);

  const load = useCallback(() => {
    setLoading(true);
    api.offers
      .map(query)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query]);

  // La recherche libre se tape lettre à lettre : sans ce délai, chaque touche
  // déclencherait une requête et un recadrage.
  useEffect(() => {
    const timer = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  /*
   * Géocodage en cours côté serveur : il avance à une adresse par seconde. On
   * revient chercher le résultat une fois le lot fini, et la carte se remplit
   * sous les yeux plutôt que d'exiger un rechargement manuel.
   */
  useEffect(() => {
    if (!data.resolving) return undefined;
    const timer = setTimeout(load, data.resolving * 1200 + 1500);
    return () => clearTimeout(timer);
  }, [data.resolving, load]);

  const groupes = useMemo(() => grouper(data.offers || []), [data.offers]);

  // Recadrage sur ce qui est affiché, une fois par jeu de filtres.
  useEffect(() => {
    if (loading || cadreFait.current === query) return;
    cadreFait.current = query;
    setView(cadrer(groupes));
    setSelection(null);
  }, [groupes, loading, query]);

  const plateformes = useMemo(() => {
    const compte = {};
    for (const offer of data.offers || []) {
      compte[offer.source] = (compte[offer.source] || 0) + 1;
    }
    return Object.entries(compte)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        value,
        label: SOURCE_LABELS[value] || value,
        color: SOURCE_COLORS[value] || SOURCE_COLORS.autre,
        count,
      }));
  }, [data.offers]);

  const groupeActif = groupes.find((groupe) => groupe.cle === selection) || null;
  const filtreActif = Boolean(q || source || contractType || remote);
  const aSituer = (data.pending || 0) + (data.resolving || 0);

  const reset = () => {
    setQ('');
    setSource('');
    setContractType('');
    setRemote('');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Carte</h1>
          <p>Où sont les offres. Les adresses sont situées à la ville, puis groupées.</p>
        </div>
        <button className="btn btn-sm" onClick={() => setView(cadrer(groupes))}>
          Recadrer
        </button>
      </div>

      <div className="panel filters">
        <SearchField value={q} onChange={setQ} placeholder="Intitulé, entreprise…" />

        {plateformes.length > 1 && (
          <ChipGroup
            label="Plateforme"
            value={source}
            onChange={setSource}
            options={plateformes}
            allLabel="Toutes"
          />
        )}

        <ChipGroup
          label="Contrat"
          value={contractType}
          onChange={setContractType}
          options={CONTRATS}
        />

        <ChipGroup label="Travail" value={remote} onChange={setRemote} options={MODES} />

        <FilterFooter
          shown={data.offers?.length || 0}
          total={data.offers?.length || 0}
          noun="offre"
          active={filtreActif}
          onReset={reset}
        />
      </div>

      {/*
        Une carte à moitié pleine ressemble à une carte cassée : on dit
        explicitement ce qui manque et pourquoi, plutôt que de laisser croire
        que ces offres n'existent pas.
      */}
      {aSituer > 0 && (
        <div className="map-notice">
          <span>
            <strong>{aSituer}</strong> offre{aSituer > 1 ? 's' : ''} pas encore située
            {aSituer > 1 ? 's' : ''}.
            {data.resolving > 0
              ? ` ${data.resolving} adresse${data.resolving > 1 ? 's sont' : ' est'} en cours de résolution — la carte se complète toute seule.`
              : ' Reviens sur cet onglet pour en résoudre le lot suivant.'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        </div>
      )}

      {error ? (
        <div className="empty">Erreur : {error}</div>
      ) : (
        <div className="map-layout">
          <div className="map-canvas">
            <SlippyMap view={view} onView={setView}>
              {({ projeter, largeur, hauteur }) =>
                groupes.map((groupe) => {
                  const { x, y } = projeter(groupe.lat, groupe.lon);
                  // Hors champ : ne rien poser du tout, plutôt que de laisser
                  // des centaines de nœuds invisibles ralentir le glissement.
                  if (x < -60 || y < -60 || x > largeur + 60 || y > hauteur + 60) return null;

                  const nombre = groupe.offers.length;
                  const taille = Math.min(46, 24 + Math.round(Math.log2(nombre) * 7));
                  const couleur = SOURCE_COLORS[groupe.source] || SOURCE_COLORS.autre;

                  return (
                    <button
                      key={groupe.cle}
                      data-no-pan
                      className={'map-pin' + (selection === groupe.cle ? ' active' : '')}
                      style={{
                        left: x,
                        top: y,
                        width: taille,
                        height: taille,
                        background: couleur,
                      }}
                      title={`${groupe.lieu} — ${nombre} offre${nombre > 1 ? 's' : ''}`}
                      onClick={() => setSelection(groupe.cle === selection ? null : groupe.cle)}
                    >
                      {nombre}
                    </button>
                  );
                })
              }
            </SlippyMap>

            {loading && data.offers.length === 0 && (
              <div className="map-veil">Chargement de la carte…</div>
            )}

            {!loading && groupes.length === 0 && (
              <div className="map-veil">
                {aSituer > 0
                  ? 'Aucune adresse encore résolue. Laisse la page ouverte quelques secondes.'
                  : 'Aucune offre à placer. Lance une recherche depuis l’onglet Offres.'}
              </div>
            )}

            {plateformes.length > 0 && (
              <div className="map-legend">
                {plateformes.map((item) => (
                  <button
                    key={item.value}
                    className={'map-legend-item' + (source === item.value ? ' active' : '')}
                    onClick={() => setSource(source === item.value ? '' : item.value)}
                  >
                    <i style={{ background: item.color }} />
                    {item.label}
                    <em>{item.count}</em>
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="map-side panel">
            {groupeActif ? (
              <>
                <div className="map-side-head">
                  <div>
                    <strong>{groupeActif.lieu}</strong>
                    <span className="muted">
                      {groupeActif.offers.length} offre{groupeActif.offers.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelection(null)}
                    aria-label="Fermer"
                  >
                    ×
                  </button>
                </div>

                <div className="map-side-list">
                  {groupeActif.offers.map((offer) => (
                    <Link key={offer._id} className="map-offer" to={`/offres/${offer._id}`}>
                      <span className="map-offer-title">{offer.title}</span>
                      <span className="map-offer-meta">
                        {offer.company || 'Entreprise non précisée'}
                        {dateCourte(offer.publishedAt) ? ` · ${dateCourte(offer.publishedAt)}` : ''}
                      </span>
                      <span className="map-offer-tags">
                        <em style={{ color: SOURCE_COLORS[offer.source] }}>
                          {SOURCE_LABELS[offer.source] || offer.source}
                        </em>
                        {offer.contractType !== 'autre' && (
                          <em>{CONTRACT_LABELS[offer.contractType]}</em>
                        )}
                        {offer.remote !== 'non_precise' && <em>{REMOTE_LABELS[offer.remote]}</em>}
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <div className="map-side-empty">
                <strong>{data.offers.length} offres situées</strong>
                <span className="muted">
                  {groupes.length} lieu{groupes.length > 1 ? 'x' : ''} sur la carte. Clique un
                  marqueur pour voir ce qu'il contient.
                </span>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
