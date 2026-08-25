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

// Même trait que les icônes de la navigation, pour que rien ne détonne.
const trait = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

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
  /*
   * Le demi-pas décale la couronne de sorte qu'aucune épingle ne tombe à la
   * verticale du point : c'est là que monte la colonne, et l'épingle s'y
   * retrouverait cachée derrière le fût.
   */
  const angle = ((restant + 0.5) / capacite) * 2 * Math.PI - Math.PI / 2;
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
      /*
       * L'habillage vit dans un enfant, jamais sur le marqueur lui-même.
       *
       * MapLibre positionne un marqueur en écrivant `transform` sur son
       * élément. Y poser une animation ou un `scale` au survol écrase ce
       * calcul : le marqueur retombe alors sur le point d'ancrage, et toute la
       * couronne s'effondre en un tas. L'enfant, lui, peut être transformé
       * autant qu'on veut.
       */
      colonne.innerHTML =
        '<span class="map-city-inner">' +
        `<span class="map-city-badge">${nombre}</span>` +
        `<span class="map-city-bar" style="height:${hauteurColonne(nombre)}px"></span>` +
        '<span class="map-city-base"></span>' +
        '</span>';
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
        // Les épingles apparaissent l'une après l'autre : le déploiement se lit
        // comme un geste, au lieu de faire surgir trente points d'un bloc.
        epingle.style.setProperty('--rang', String(index));
        // Même raison que pour la colonne : le `transform` du marqueur est à
        // MapLibre, l'habillage à l'enfant.
        epingle.innerHTML = '<span class="map-pin-dot"></span>';
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

  // Les six lieux les plus fournis, pour le classement du panneau au repos.
  const tetes = useMemo(
    () => [...groupes].sort((a, b) => b.offers.length - a.offers.length).slice(0, 6),
    [groupes]
  );

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
        <div className="map-actions">
          {/* Un interrupteur segmenté plutôt qu'un bouton à bascule : les deux
              états sont visibles d'un coup, sans avoir à deviner si l'étiquette
              nomme l'état courant ou celui qu'on obtiendra en cliquant. */}
          <div className="seg" role="group" aria-label="Angle de vue">
            <button
              className={'seg-btn' + (relief ? ' active' : '')}
              onClick={() => setRelief(true)}
            >
              3D
            </button>
            <button
              className={'seg-btn' + (!relief ? ' active' : '')}
              onClick={() => setRelief(false)}
            >
              2D
            </button>
          </div>
          <button className="btn btn-sm" onClick={() => recadrer(true)}>
            <svg viewBox="0 0 24 24" width="15" height="15" {...trait}>
              <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
            </svg>
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
                <span
                  className="map-detail-source"
                  style={{ background: SOURCE_COLORS[offreDetail.source] || SOURCE_COLORS.autre }}
                >
                  {SOURCE_LABELS[offreDetail.source] || offreDetail.source}
                </span>
                <h2>{offreDetail.title}</h2>
                <p className="muted">
                  {offreDetail.company || 'Entreprise non précisée'}
                  {offreDetail.location ? ` · ${offreDetail.location}` : ''}
                </p>
                <div className="map-offer-tags">
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
                <div className="map-side-titre">
                  {/* La puce reprend la couleur de la colonne : on relie d'un
                      coup d'œil le panneau au point qu'on vient de cliquer. */}
                  <i className="map-side-puce" style={{ background: groupeActif.couleur }} />
                  <div>
                    <strong>{groupeActif.lieu}</strong>
                    <span className="muted">
                      {groupeActif.offers.length} offre{groupeActif.offers.length > 1 ? 's' : ''}
                      {groupeActif.offers.length > MAX_EPINGLES
                        ? ` · ${MAX_EPINGLES} épinglées sur la carte`
                        : ''}
                    </span>
                  </div>
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
              <div className="map-stat">
                <strong>{data.offers.length}</strong>
                <span>
                  offre{data.offers.length > 1 ? 's' : ''} située
                  {data.offers.length > 1 ? 's' : ''} sur {groupes.length} lieu
                  {groupes.length > 1 ? 'x' : ''}
                </span>
              </div>

              {/* Le panneau était un grand vide blanc tant que rien n'était
                  sélectionné. Le classement remplit cette place par quelque
                  chose d'utile : où sont les offres, et un raccourci pour y
                  aller sans chercher la colonne à l'œil. */}
              {tetes.length > 0 && (
                <div className="map-top">
                  <div className="section-label">Les lieux les plus fournis</div>
                  {tetes.map((groupe) => (
                    <button
                      key={groupe.cle}
                      className="map-top-row"
                      onClick={() => {
                        setVilleActive(groupe.cle);
                        approcher(groupe);
                      }}
                    >
                      <span className="map-top-nom">{groupe.lieu}</span>
                      <span className="map-top-jauge">
                        <i
                          style={{
                            width: `${Math.round((groupe.offers.length / tetes[0].offers.length) * 100)}%`,
                            background: groupe.couleur,
                          }}
                        />
                      </span>
                      <em>{groupe.offers.length}</em>
                    </button>
                  ))}
                </div>
              )}

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
