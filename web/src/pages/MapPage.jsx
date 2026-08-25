import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
/*
 * MapLibre 6 n'expose plus d'export par défaut : on nomme ce dont on se sert.
 * `Map` est renommé, sans quoi il masquerait le `Map` natif — dont ce fichier
 * se sert pour regrouper les offres.
 */
import {
  Map as MapLibre,
  Marker,
  NavigationControl,
  FullscreenControl,
  ScaleControl,
  LngLatBounds,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../api/client.js';
import { SearchField, ChipGroup } from '../components/FilterBar.jsx';
import {
  SOURCE_LABELS,
  SOURCE_COLORS,
  CONTRACT_LABELS,
  REMOTE_LABELS,
} from '../lib/status.js';

const CONTRATS = Object.entries(CONTRACT_LABELS).map(([value, label]) => ({ value, label }));
const MODES = Object.entries(REMOTE_LABELS).map(([value, label]) => ({ value, label }));

/*
 * Fond de carte.
 *
 * Les tuiles raster d'OpenStreetMap ne demandent aucune clé d'API, à la
 * différence des fonds vectoriels. MapLibre les incline et les fait pivoter
 * comme n'importe quel autre fond : le relief vient de la caméra et des
 * colonnes posées par-dessus, pas du fond lui-même.
 */
const STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'fond', type: 'raster', source: 'osm' }],
};

const PITCH_3D = 52;

// Au-delà, la couronne de marqueurs devient un mur illisible : on en montre une
// part et le panneau latéral garde la liste complète.
const MAX_EPINGLES = 36;

/**
 * Groupe les offres par point.
 *
 * Une adresse est résolue à la ville : les quarante annonces parisiennes
 * partagent exactement les mêmes coordonnées. Sans regroupement elles se
 * superposeraient en un seul point, les trente-neuf du dessous devenant
 * inatteignables — c'est précisément ce que la sélection offre par offre doit
 * défaire, en les écartant en couronne autour de leur ville.
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

  return [...groupes.values()].map((groupe) => {
    const dominante = Object.entries(groupe.sources).sort((a, b) => b[1] - a[1])[0][0];
    return {
      ...groupe,
      lieu: groupe.offers[0].location || 'Lieu inconnu',
      couleur: SOURCE_COLORS[dominante] || SOURCE_COLORS.autre,
    };
  });
}

/**
 * Hauteur de la colonne d'une ville, en pixels.
 *
 * Logarithmique : une ville à cent offres ne doit pas écraser de vingt fois sa
 * hauteur une ville à cinq. Bornée, sinon la plus fournie sortirait de l'écran.
 *
 * La colonne est dessinée en HTML plutôt qu'en extrusion MapLibre. Une
 * extrusion se mesure en mètres : pour garder une hauteur constante à l'écran
 * il fallait la recalculer à chaque zoom, et à l'échelle d'un continent elle
 * atteignait des centaines de kilomètres — au-delà de ce que MapLibre encode,
 * si bien que la couche ne dessinait plus rien du tout. En pixels, le problème
 * n'existe pas.
 */
function hauteurColonne(nombre) {
  return Math.round(Math.min(84, 14 + 16 * Math.log2(nombre + 1)));
}

/**
 * Décalage en pixels de la n-ième épingle autour de sa ville.
 *
 * En anneaux successifs, dont la capacité croît avec le rayon : un seul cercle
 * suffirait pour huit offres, pas pour trente.
 */
function positionCouronne(index) {
  let anneau = 0;
  let restant = index;
  let capacite = 8;

  while (restant >= capacite) {
    restant -= capacite;
    anneau += 1;
    capacite += 6;
  }

  const rayon = 62 + anneau * 40;
  // Un demi-pas de décalage par anneau : les épingles ne s'alignent pas en
  // rayons, qui donneraient l'illusion de branches vides entre elles.
  const angle = ((restant + (anneau % 2) * 0.5) / capacite) * 2 * Math.PI - Math.PI / 2;
  return [Math.cos(angle) * rayon, Math.sin(angle) * rayon];
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

  const [pret, setPret] = useState(false);
  const [relief, setRelief] = useState(true);
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [villeActive, setVilleActive] = useState(null);
  const [offreActive, setOffreActive] = useState(null);

  const conteneur = useRef(null);
  const carte = useRef(null);
  const marqueurs = useRef([]);
  // Les gestionnaires d'évènements de la carte sont posés une seule fois : ils
  // lisent les données ici plutôt que dans une clôture, qui serait figée sur le
  // premier rendu.
  const groupesRef = useRef([]);
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

  // La recherche se tape lettre à lettre : sans ce délai, chaque touche
  // déclencherait une requête.
  useEffect(() => {
    const timer = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  /*
   * Le géocodage avance côté serveur à une adresse par seconde. On revient
   * chercher le lot suivant quand il doit être prêt : la carte se remplit sous
   * les yeux au lieu d'exiger un rechargement.
   */
  useEffect(() => {
    if (!data.resolving) return undefined;
    const timer = setTimeout(load, data.resolving * 1200 + 1500);
    return () => clearTimeout(timer);
  }, [data.resolving, load]);

  const groupes = useMemo(() => grouper(data.offers || []), [data.offers]);
  groupesRef.current = groupes;

  // --- Création de la carte, une fois pour toutes -------------------------
  useEffect(() => {
    const map = new MapLibre({
      container: conteneur.current,
      style: STYLE,
      center: [2.4, 46.6],
      zoom: 4.6,
      pitch: PITCH_3D,
      bearing: -12,
      attributionControl: { compact: true },
      // Le clic droit fait pivoter et incliner : c'est le geste attendu sur une
      // carte 3D, et il évite d'avoir à trouver la boussole.
      dragRotate: true,
      maxPitch: 70,
    });
    carte.current = map;
    // Une carte se met au point à la console : angle, zoom, couches rendues.
    // Uniquement en développement — rien n'est exposé sur le site déployé.
    if (import.meta.env.DEV) window.__carte = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new FullscreenControl(), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => setPret(true));

    // Cliquer le fond referme ce qui est ouvert. Les colonnes et les épingles
    // sont des marqueurs HTML : leur clic n'atteint jamais ce gestionnaire.
    map.on('click', () => {
      setVilleActive(null);
      setOffreActive(null);
    });

    return () => {
      map.remove();
      carte.current = null;
      setPret(false);
    };
  }, []);

  /**
   * Ouvrir une ville l'amène au centre, à un zoom de ville.
   *
   * Les épingles s'écartent d'un rayon exprimé en pixels : à l'échelle d'un
   * continent, la couronne recouvre trois pays et ne se lit plus comme un
   * éventail autour d'un point. En s'approchant, elle retombe sur la ville
   * qu'elle décrit.
   */
  const approcher = useCallback((groupe) => {
    const map = carte.current;
    if (!map || !groupe) return;
    map.easeTo({
      center: [groupe.lon, groupe.lat],
      zoom: Math.max(map.getZoom(), 8.5),
      duration: 700,
    });
  }, []);

  // --- Marqueurs : pastilles de ville, puis épingles de la ville ouverte ---
  useEffect(() => {
    const map = carte.current;
    if (!pret || !map) return undefined;

    for (const marqueur of marqueurs.current) marqueur.remove();
    marqueurs.current = [];

    const poser = (element, lngLat, { anchor = 'center', offset = [0, 0] } = {}) => {
      const marqueur = new Marker({ element, anchor, offset }).setLngLat(lngLat).addTo(map);
      marqueurs.current.push(marqueur);
    };

    for (const groupe of groupes) {
      const ouverte = groupe.cle === villeActive;
      const nombre = groupe.offers.length;

      /*
       * La colonne : un socle posé au sol, un fût dont la hauteur dit le nombre
       * d'offres, et la pastille du compte à son sommet. Ancrée par le bas, si
       * bien que c'est bien son pied qui repose sur les coordonnées — et non son
       * milieu, qui la ferait flotter à côté de la ville.
       */
      const colonne = document.createElement('button');
      colonne.type = 'button';
      colonne.className = 'map-city' + (ouverte ? ' is-open' : '');
      colonne.style.setProperty('--couleur', groupe.couleur);
      colonne.title = `${groupe.lieu} — ${nombre} offre${nombre > 1 ? 's' : ''}`;
      colonne.innerHTML =
        `<span class="map-city-badge">${nombre}</span>` +
        `<span class="map-city-bar" style="height:${hauteurColonne(nombre)}px"></span>` +
        '<span class="map-city-base"></span>';
      /*
       * Les marqueurs vivent dans le conteneur de la toile : sans cet arrêt, le
       * clic remonte jusqu'au gestionnaire de la carte, qui referme dans la
       * foulée ce qu'on vient d'ouvrir.
       */
      colonne.addEventListener('click', (event) => {
        event.stopPropagation();
        setVilleActive(ouverte ? null : groupe.cle);
        setOffreActive(null);
        if (!ouverte) approcher(groupe);
      });
      poser(colonne, [groupe.lon, groupe.lat], { anchor: 'bottom' });

      if (!ouverte) continue;

      /*
       * Chaque offre reçoit sa propre épingle, écartée d'un décalage en pixels.
       *
       * Le décalage est en pixels d'écran, pas en degrés : la couronne garde
       * donc exactement la même forme à tous les zooms, et rien n'a besoin
       * d'être recalculé quand la carte bouge.
       */
      groupe.offers.slice(0, MAX_EPINGLES).forEach((offer, index) => {
        const epingle = document.createElement('button');
        epingle.type = 'button';
        epingle.className = 'map-pin' + (offer._id === offreActive ? ' is-active' : '');
        epingle.style.setProperty('--couleur', SOURCE_COLORS[offer.source] || SOURCE_COLORS.autre);
        epingle.innerHTML = '<span></span>';
        epingle.title = `${offer.title}${offer.company ? ` — ${offer.company}` : ''}`;
        epingle.addEventListener('click', (event) => {
          event.stopPropagation();
          setOffreActive(offer._id);
        });
        poser(epingle, [groupe.lon, groupe.lat], { offset: positionCouronne(index) });
      });
    }

    return () => {
      for (const marqueur of marqueurs.current) marqueur.remove();
      marqueurs.current = [];
    };
  }, [approcher, groupes, pret, villeActive, offreActive]);

  // --- Cadrage : une fois par jeu de filtres ------------------------------
  const recadrer = useCallback(
    (animer = true) => {
      const map = carte.current;
      const points = groupesRef.current;
      if (!map || !points.length) return;

      const bornes = new LngLatBounds();
      for (const groupe of points) bornes.extend([groupe.lon, groupe.lat]);

      /*
       * L'angle courant est repassé explicitement.
       *
       * `fitBounds` ne se contente pas de calculer un centre et un zoom : à
       * défaut d'indication, il remet le pitch et le bearing à zéro. Recadrer
       * aplatissait donc la carte, et la 3D disparaissait au premier clic sur
       * « Recadrer ».
       */
      map.fitBounds(bornes, {
        padding: 90,
        maxZoom: 11,
        duration: animer ? 900 : 0,
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    },
    []
  );

  useEffect(() => {
    if (!pret || loading || cadreFait.current === query) return;
    cadreFait.current = query;
    setVilleActive(null);
    setOffreActive(null);
    recadrer(true);
  }, [groupes, loading, pret, query, recadrer]);

  /*
   * Déplier les filtres décale la carte : MapLibre doit reprendre la mesure de
   * son conteneur, sinon la projection reste calée sur l'ancienne position et
   * les marqueurs tombent à côté de ce qu'ils désignent.
   */
  useEffect(() => {
    if (pret) carte.current?.resize();
  }, [filtresOuverts, pret]);

  // --- Bascule 2D / 3D ----------------------------------------------------
  useEffect(() => {
    const map = carte.current;
    if (!pret || !map) return;
    map.easeTo({ pitch: relief ? PITCH_3D : 0, bearing: relief ? map.getBearing() : 0, duration: 600 });
  }, [relief, pret]);

  const plateformes = useMemo(() => {
    const compte = {};
    for (const offer of data.offers || []) compte[offer.source] = (compte[offer.source] || 0) + 1;
    return Object.entries(compte)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        value,
        label: SOURCE_LABELS[value] || value,
        color: SOURCE_COLORS[value] || SOURCE_COLORS.autre,
        count,
      }));
  }, [data.offers]);

  const groupeActif = groupes.find((groupe) => groupe.cle === villeActive) || null;
  const offreDetail = groupeActif?.offers.find((offer) => offer._id === offreActive) || null;
  const filtreActif = Boolean(q || source || contractType || remote);
  const filtresPoses = [source, contractType, remote].filter(Boolean).length;
  const aSituer = (data.pending || 0) + (data.resolving || 0);

  const reset = () => {
    setQ('');
    setSource('');
    setContractType('');
    setRemote('');
  };

  const ouvrirOffre = (groupe, offer) => {
    setVilleActive(groupe.cle);
    setOffreActive(offer._id);
    approcher(groupe);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Carte</h1>
          <p>
            Une colonne par ville, sa hauteur dit le nombre d'offres. Clique-la pour les déployer.
          </p>
        </div>
        <div className="row">
          <button
            className={'btn btn-sm' + (relief ? ' btn-primary' : '')}
            onClick={() => setRelief((valeur) => !valeur)}
            title="Incliner la caméra"
          >
            {relief ? '3D' : '2D'}
          </button>
          <button className="btn btn-sm" onClick={() => recadrer(true)}>
            Recadrer
          </button>
        </div>
      </div>

      {/*
        Les filtres sont repliés par défaut.
        Déployés, leurs quatre rangées de pastilles poussaient la carte sous la
        ligne de flottaison : on arrivait sur un écran de filtres, et il fallait
        faire défiler pour trouver la carte qu'on était venu voir.
      */}
      <div className="panel map-filters">
        <div className="map-filters-bar">
          <SearchField value={q} onChange={setQ} placeholder="Intitulé, entreprise…" />
          <button
            className={'btn btn-sm' + (filtresOuverts ? ' btn-primary' : '')}
            onClick={() => setFiltresOuverts((valeur) => !valeur)}
          >
            Filtres{filtresPoses ? ` · ${filtresPoses}` : ''}
          </button>
          {filtreActif && (
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              Réinitialiser
            </button>
          )}
          <span className="muted map-filters-count">
            {data.offers.length} offre{data.offers.length > 1 ? 's' : ''} · {groupes.length} lieu
            {groupes.length > 1 ? 'x' : ''}
          </span>
        </div>

        {filtresOuverts && (
          <div className="map-filters-detail">
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
          </div>
        )}
      </div>

      {/*
        Une carte à moitié pleine ressemble à une carte cassée : on dit ce qui
        manque plutôt que de laisser croire que ces offres n'existent pas.
      */}
      {aSituer > 0 && (
        <div className="map-notice">
          <span>
            <strong>{aSituer}</strong> offre{aSituer > 1 ? 's' : ''} pas encore située
            {aSituer > 1 ? 's' : ''}.
            {data.resolving > 0
              ? ` ${data.resolving} adresse${
                  data.resolving > 1 ? 's sont' : ' est'
                } en cours de résolution — la carte se complète toute seule.`
              : ' Reviens sur cet onglet pour résoudre le lot suivant.'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        </div>
      )}

      {error && <div className="empty">Erreur : {error}</div>}

      <div className="map-layout">
        <div className="map-canvas">
          <div ref={conteneur} className="map-gl" />

          {!loading && groupes.length === 0 && (
            <div className="map-veil">
              {aSituer > 0
                ? 'Aucune adresse encore résolue. Laisse la page ouverte quelques secondes.'
                : "Aucune offre à placer. Lance une recherche depuis l'onglet Offres."}
            </div>
          )}

          {plateformes.length > 0 && (
            <div className="map-legend">
              {plateformes.map((item) => (
                <button
                  key={item.value}
                  className={'map-legend-item' + (source === item.value ? ' active' : '')}
                  onClick={() => setSource(source === item.value ? '' : item.value)}
                  title={`N'afficher que ${item.label}`}
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
          {offreDetail ? (
            <>
              <div className="map-side-head">
                <button className="btn btn-ghost btn-sm" onClick={() => setOffreActive(null)}>
                  ← {groupeActif.lieu}
                </button>
              </div>
              <div className="map-side-detail">
                <h2>{offreDetail.title}</h2>
                <p className="muted">
                  {offreDetail.company || 'Entreprise non précisée'}
                  {offreDetail.location ? ` · ${offreDetail.location}` : ''}
                </p>
                <div className="map-offer-tags">
                  <em style={{ color: SOURCE_COLORS[offreDetail.source] }}>
                    {SOURCE_LABELS[offreDetail.source] || offreDetail.source}
                  </em>
                  {offreDetail.contractType !== 'autre' && (
                    <em>{CONTRACT_LABELS[offreDetail.contractType]}</em>
                  )}
                  {offreDetail.remote !== 'non_precise' && (
                    <em>{REMOTE_LABELS[offreDetail.remote]}</em>
                  )}
                  {dateCourte(offreDetail.publishedAt) && (
                    <em>Publiée le {dateCourte(offreDetail.publishedAt)}</em>
                  )}
                  {typeof offreDetail.applicantCount === 'number' && (
                    <em>{offreDetail.applicantCount} candidats</em>
                  )}
                </div>
                <div className="map-side-actions">
                  <Link className="btn btn-primary btn-sm" to={`/offres/${offreDetail._id}`}>
                    Ouvrir la fiche
                  </Link>
                  {offreDetail.sourceUrl && (
                    <a
                      className="btn btn-sm"
                      href={offreDetail.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      L'annonce d'origine
                    </a>
                  )}
                </div>
              </div>
            </>
          ) : groupeActif ? (
            <>
              <div className="map-side-head">
                <div>
                  <strong>{groupeActif.lieu}</strong>
                  <span className="muted">
                    {groupeActif.offers.length} offre{groupeActif.offers.length > 1 ? 's' : ''}
                    {groupeActif.offers.length > MAX_EPINGLES
                      ? ` · ${MAX_EPINGLES} épinglées sur la carte`
                      : ''}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setVilleActive(null)}
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>

              <div className="map-side-list">
                {groupeActif.offers.map((offer) => (
                  <button
                    key={offer._id}
                    className="map-offer"
                    onClick={() => ouvrirOffre(groupeActif, offer)}
                  >
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
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="map-side-empty">
              <strong>
                {data.offers.length} offre{data.offers.length > 1 ? 's' : ''} située
                {data.offers.length > 1 ? 's' : ''}
              </strong>
              <span className="muted">
                Réparties sur {groupes.length} lieu{groupes.length > 1 ? 'x' : ''}.
              </span>
              <ul className="map-help">
                <li>Clique une colonne pour déployer ses offres une par une.</li>
                <li>Clic droit maintenu : faire pivoter et incliner la vue.</li>
                <li>La légende sert de filtre par plateforme.</li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
