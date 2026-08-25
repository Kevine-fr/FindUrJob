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
 * comme n'importe quel autre fond : le relief vient de la caméra, pas du fond.
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

/*
 * Distance, en pixels d'écran, en deçà de laquelle deux lieux sont réunis.
 *
 * C'est un seuil en pixels et non en kilomètres : c'est précisément ce qui rend
 * le regroupement dynamique. Deux communes voisines se touchent à l'échelle
 * d'un pays et se détachent d'elles-mêmes en zoomant, sans qu'on ait à fixer
 * de paliers.
 */
const RAYON_AMAS = 58;

// Au-delà, la couronne devient un mur illisible : on en montre une part, et le
// panneau latéral garde la liste complète.
const MAX_EPINGLES = 36;

/**
 * Groupe les offres par coordonnées.
 *
 * Les adresses sont géocodées à la ville : toutes les offres d'une même ville
 * partagent des coordonnées *identiques*. Ce premier regroupement, lui, ne
 * dépend pas du zoom — ces points-là ne se sépareront jamais.
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
 * Réunit les lieux trop proches à l'écran pour être distingués.
 *
 * Algorithme glouton : les lieux les plus fournis servent d'ancres et absorbent
 * leurs voisins. C'est ce qui donne des amas centrés sur les métropoles plutôt
 * que sur la première commune rencontrée.
 *
 * Le coût est quadratique, mais il porte sur le nombre de *lieux distincts* —
 * quelques dizaines, rarement plus — et non sur le nombre d'offres.
 */
function amasser(groupes, projeter) {
  const points = groupes
    .map((groupe) => ({ groupe, ecran: projeter(groupe) }))
    .sort((a, b) => b.groupe.offers.length - a.groupe.offers.length);

  const pris = new Set();
  const amas = [];

  for (const point of points) {
    if (pris.has(point.groupe.cle)) continue;
    pris.add(point.groupe.cle);

    const membres = [point.groupe];
    for (const autre of points) {
      if (pris.has(autre.groupe.cle)) continue;
      const dx = autre.ecran.x - point.ecran.x;
      const dy = autre.ecran.y - point.ecran.y;
      if (dx * dx + dy * dy <= RAYON_AMAS * RAYON_AMAS) {
        pris.add(autre.groupe.cle);
        membres.push(autre.groupe);
      }
    }

    const total = membres.reduce((somme, membre) => somme + membre.offers.length, 0);
    const sources = {};
    for (const membre of membres) {
      for (const [cle, nombre] of Object.entries(membre.sources)) {
        sources[cle] = (sources[cle] || 0) + nombre;
      }
    }

    amas.push({
      // La clé décrit ce que l'amas contient : tant qu'il contient la même
      // chose, son marqueur est réutilisé et ne clignote pas.
      cle: membres
        .map((membre) => membre.cle)
        .sort()
        .join('|'),
      // Le point d'ancrage reste celui du lieu principal : une moyenne
      // pondérée tomberait entre deux villes, sur aucune des deux.
      lat: point.groupe.lat,
      lon: point.groupe.lon,
      lieu: point.groupe.lieu,
      couleur: point.groupe.couleur,
      membres,
      sources,
      total,
    });
  }

  return amas;
}

/**
 * Décalage en pixels de la n-ième épingle autour de son point.
 *
 * En anneaux successifs dont la capacité croît avec le rayon : un seul cercle
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

  const rayon = 58 + anneau * 38;
  // Le demi-pas évite qu'une épingle tombe pile sous l'amas qui l'a ouverte.
  const angle = ((restant + 0.5) / capacite) * 2 * Math.PI - Math.PI / 2;
  return [Math.cos(angle) * rayon, Math.sin(angle) * rayon];
}

/**
 * Couronne colorée d'un amas, en dégradé conique.
 *
 * Le nombre seul ne dit pas ce qu'il y a dedans. La part de chaque plateforme
 * se lit ici d'un coup d'œil, sans avoir à ouvrir l'amas.
 */
function anneauDeCouleurs(sources, total) {
  const parts = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  let cumul = 0;
  const arrets = parts.map(([cle, nombre]) => {
    const debut = (cumul / total) * 360;
    cumul += nombre;
    const couleur = SOURCE_COLORS[cle] || SOURCE_COLORS.autre;
    return `${couleur} ${debut.toFixed(2)}deg ${((cumul / total) * 360).toFixed(2)}deg`;
  });
  return `conic-gradient(${arrets.join(', ')})`;
}

/** Diamètre d'un amas : logarithmique, pour que dix ne soit pas dix fois un. */
function tailleAmas(nombre) {
  return Math.round(Math.min(58, 30 + 7 * Math.log2(nombre)));
}

/**
 * Épingle d'une offre : une goutte, et une mallette dedans.
 *
 * Un disque numéroté ne disait rien de ce qu'il désignait. La forme en goutte
 * pointe l'adresse exacte, la mallette dit qu'il s'agit d'un poste, et la
 * couleur d'où vient l'annonce.
 */
function goutteSvg(couleur) {
  return `
    <svg viewBox="0 0 26 34" width="26" height="34" aria-hidden="true">
      <path d="M13 33.2C13 33.2 25 21.5 25 13A12 12 0 1 0 1 13c0 8.5 12 20.2 12 20.2z"
            fill="${couleur}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="13" cy="13" r="7.6" fill="#fff" fill-opacity="0.94"/>
      <g fill="none" stroke="${couleur}" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round">
        <rect x="8.6" y="11" width="8.8" height="6.4" rx="1.2"/>
        <path d="M11.2 11v-1.1a1.1 1.1 0 0 1 1.1-1.1h1.4a1.1 1.1 0 0 1 1.1 1.1V11"/>
        <path d="M8.6 13.4h8.8"/>
      </g>
    </svg>`;
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
  // Ce qui est ouvert en éventail, et l'offre choisie dedans.
  const [eventail, setEventail] = useState(null);
  const [offreActive, setOffreActive] = useState(null);

  const conteneur = useRef(null);
  const carte = useRef(null);
  // Marqueurs d'amas, indexés par leur contenu : on n'ajoute et ne retire que
  // ce qui change d'une vue à l'autre, sinon la carte clignoterait à chaque
  // déplacement.
  const marqueurs = useRef(new Map());
  const epingles = useRef([]);
  /*
   * Les gestionnaires d'évènements de la carte sont posés une seule fois, au
   * montage : ils lisent l'état ici plutôt que dans une clôture, qui resterait
   * figée sur le premier rendu.
   */
  const groupesRef = useRef([]);
  const synchroniserRef = useRef(() => {});
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

  const approcher = useCallback((point, zoomMini = 10) => {
    const map = carte.current;
    if (!map || !point) return;
    map.easeTo({
      center: [point.lon, point.lat],
      zoom: Math.max(map.getZoom(), zoomMini),
      duration: 700,
    });
  }, []);

  /** Ouvre un amas en éventail : ses offres, une par une, autour de son point. */
  const deployer = useCallback(
    (amas) => {
      const offers = amas.membres.flatMap((membre) => membre.offers);
      setEventail({
        cle: amas.cle,
        lieu: amas.membres.length > 1 ? `${amas.lieu} et alentours` : amas.lieu,
        lat: amas.lat,
        lon: amas.lon,
        couleur: amas.couleur,
        offers,
      });
      setOffreActive(null);
      approcher(amas, 10);
    },
    [approcher]
  );

  /**
   * Clic sur un amas.
   *
   * Tant que ses membres peuvent se séparer en zoomant, on zoome : c'est le
   * geste attendu, et la séparation se fait alors toute seule. Quand l'amas
   * n'a qu'un lieu — toutes les offres à la même adresse — aucun zoom ne les
   * séparera jamais : on les écarte en éventail.
   */
  const ouvrirAmas = useCallback(
    (amas) => {
      const map = carte.current;
      if (!map) return;

      if (amas.membres.length > 1) {
        const bornes = new LngLatBounds();
        for (const membre of amas.membres) bornes.extend([membre.lon, membre.lat]);
        const cible = map.cameraForBounds(bornes, { padding: 120, maxZoom: 16 });

        // Un zoom qui ne gagne rien laisserait l'amas fermé sur lui-même :
        // dans ce cas on l'ouvre plutôt que de ne rien faire.
        if (cible && cible.zoom > map.getZoom() + 0.15) {
          map.easeTo({ ...cible, pitch: map.getPitch(), bearing: map.getBearing(), duration: 800 });
          return;
        }
      }

      deployer(amas);
    },
    [deployer]
  );

  const ouvrirOffreSeule = useCallback((groupe, offer) => {
    setEventail({
      cle: groupe.cle,
      lieu: groupe.lieu,
      lat: groupe.lat,
      lon: groupe.lon,
      couleur: groupe.couleur,
      offers: groupe.offers,
    });
    setOffreActive(offer._id);
  }, []);

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
      // carte inclinée, et il évite d'avoir à trouver la boussole.
      dragRotate: true,
      maxPitch: 70,
    });
    carte.current = map;
    // Une carte se met au point à la console : angle, zoom, amas rendus.
    // Uniquement en développement — rien n'est exposé sur le site déployé.
    if (import.meta.env.DEV) window.__carte = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new FullscreenControl(), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      setPret(true);
      synchroniserRef.current();
    });

    /*
     * Le regroupement se recalcule à chaque fin de déplacement : c'est là que
     * les amas se séparent ou se rejoignent. Pendant le mouvement, les
     * marqueurs restent accrochés à leurs coordonnées — MapLibre s'en charge —
     * et le recalcul n'arrive qu'une fois la vue posée.
     */
    map.on('moveend', () => synchroniserRef.current());

    // Cliquer le fond referme ce qui est ouvert. Amas et épingles sont des
    // marqueurs HTML : leur clic n'atteint jamais ce gestionnaire.
    map.on('click', () => {
      setEventail(null);
      setOffreActive(null);
    });

    return () => {
      map.remove();
      carte.current = null;
      setPret(false);
    };
  }, []);

  // --- Marqueurs d'amas ----------------------------------------------------
  const synchroniser = useCallback(() => {
    const map = carte.current;
    if (!map) return;

    const amas = amasser(groupesRef.current, (groupe) => map.project([groupe.lon, groupe.lat]));
    const voulus = new Map(amas.map((item) => [item.cle, item]));

    for (const [cle, marqueur] of marqueurs.current) {
      if (!voulus.has(cle)) {
        marqueur.remove();
        marqueurs.current.delete(cle);
      }
    }

    for (const [cle, item] of voulus) {
      if (marqueurs.current.has(cle)) continue;

      // Une seule offre : elle mérite son épingle, pas un amas qui afficherait
      // « 1 » — c'était le bruit qui saturait la carte.
      const seule = item.total === 1 ? item.membres[0].offers[0] : null;
      const bouton = document.createElement('button');
      bouton.type = 'button';

      if (seule) {
        bouton.className = 'map-goutte';
        bouton.dataset.offre = seule._id;
        bouton.innerHTML = goutteSvg(SOURCE_COLORS[seule.source] || SOURCE_COLORS.autre);
        bouton.title = `${seule.title}${seule.company ? ` — ${seule.company}` : ''}`;
        bouton.addEventListener('click', (event) => {
          event.stopPropagation();
          ouvrirOffreSeule(item.membres[0], seule);
        });
      } else {
        bouton.className = 'map-amas';
        bouton.style.setProperty('--taille', `${tailleAmas(item.total)}px`);
        bouton.style.setProperty('--anneau', anneauDeCouleurs(item.sources, item.total));
        bouton.title =
          item.membres.length > 1
            ? `${item.total} offres autour de ${item.lieu} — cliquer pour les séparer`
            : `${item.total} offres à ${item.lieu} — cliquer pour les ouvrir`;
        bouton.innerHTML =
          '<span class="map-amas-anneau"></span>' +
          `<span class="map-amas-coeur">${item.total}</span>`;
        bouton.addEventListener('click', (event) => {
          event.stopPropagation();
          ouvrirAmas(item);
        });
      }

      marqueurs.current.set(
        cle,
        new Marker({ element: bouton, anchor: seule ? 'bottom' : 'center' })
          .setLngLat([item.lon, item.lat])
          .addTo(map)
      );
    }
  }, [ouvrirAmas, ouvrirOffreSeule]);

  synchroniserRef.current = synchroniser;

  useEffect(() => {
    if (pret) synchroniser();
  }, [pret, synchroniser, groupes]);

  /*
   * Marque l'offre choisie en basculant une classe, sans rien reconstruire.
   *
   * Reconstruire les marqueurs à chaque sélection rejouerait leur animation
   * d'entrée : l'éventail entier se remettrait à cascader chaque fois qu'on
   * clique une épingle.
   */
  useEffect(() => {
    for (const marqueur of marqueurs.current.values()) {
      const element = marqueur.getElement();
      element.classList.toggle('is-active', element.dataset.offre === offreActive);
    }
    for (const { id, marqueur } of epingles.current) {
      marqueur.getElement().classList.toggle('is-active', id === offreActive);
    }
  }, [offreActive, eventail]);

  // --- Éventail : les offres d'un amas, écartées une à une -----------------
  useEffect(() => {
    const map = carte.current;
    if (!pret || !map) return undefined;

    for (const { marqueur } of epingles.current) marqueur.remove();
    epingles.current = [];

    if (!eventail || eventail.offers.length < 2) return undefined;

    eventail.offers.slice(0, MAX_EPINGLES).forEach((offer, index) => {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'map-goutte';
      // Les épingles entrent l'une après l'autre : le déploiement se lit comme
      // un geste, au lieu de faire surgir trente points d'un bloc.
      bouton.style.setProperty('--rang', String(index));
      bouton.innerHTML = goutteSvg(SOURCE_COLORS[offer.source] || SOURCE_COLORS.autre);
      bouton.title = `${offer.title}${offer.company ? ` — ${offer.company}` : ''}`;
      bouton.addEventListener('click', (event) => {
        event.stopPropagation();
        setOffreActive(offer._id);
      });

      epingles.current.push({
        id: offer._id,
        marqueur: new Marker({
          element: bouton,
          anchor: 'bottom',
          offset: positionCouronne(index),
        })
          .setLngLat([eventail.lon, eventail.lat])
          .addTo(map),
      });
    });

    return () => {
      for (const { marqueur } of epingles.current) marqueur.remove();
      epingles.current = [];
    };
  }, [eventail, pret]);

  // --- Cadrage : une fois par jeu de filtres ------------------------------
  const recadrer = useCallback((animer = true) => {
    const map = carte.current;
    const points = groupesRef.current;
    if (!map || !points.length) return;

    const bornes = new LngLatBounds();
    for (const groupe of points) bornes.extend([groupe.lon, groupe.lat]);

    /*
     * L'angle courant est repassé explicitement : `fitBounds` ne se contente
     * pas de calculer un centre et un zoom, il remet aussi le pitch et le
     * bearing à zéro faute d'indication. Recadrer aplatissait donc la carte.
     */
    map.fitBounds(bornes, {
      padding: 90,
      maxZoom: 11,
      duration: animer ? 900 : 0,
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    });
  }, []);

  useEffect(() => {
    if (!pret || loading || cadreFait.current === query) return;
    cadreFait.current = query;
    setEventail(null);
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

  useEffect(() => {
    const map = carte.current;
    if (!pret || !map) return;
    map.easeTo({
      pitch: relief ? PITCH_3D : 0,
      bearing: relief ? map.getBearing() : 0,
      duration: 600,
    });
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

  const offreDetail = useMemo(
    () => (offreActive ? eventail?.offers.find((o) => o._id === offreActive) || null : null),
    [eventail, offreActive]
  );
  const filtreActif = Boolean(q || source || contractType || remote);
  const filtresPoses = [source, contractType, remote].filter(Boolean).length;
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
          <p>
            Les offres se regroupent par proximité. Clique un amas pour le séparer, une épingle
            pour ouvrir l'offre.
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
        Déployés, leurs rangées de pastilles poussaient la carte sous la ligne de
        flottaison : on arrivait sur un écran de filtres, et il fallait faire
        défiler pour trouver la carte qu'on était venu voir.
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
                  ← {eventail ? eventail.lieu : 'Retour'}
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
          ) : eventail ? (
            <>
              <div className="map-side-head">
                <div className="map-side-titre">
                  {/* La puce reprend la couleur de l'amas : on relie d'un coup
                      d'œil le panneau au point qu'on vient de cliquer. */}
                  <i className="map-side-puce" style={{ background: eventail.couleur }} />
                  <div>
                    <strong>{eventail.lieu}</strong>
                    <span className="muted">
                      {eventail.offers.length} offre{eventail.offers.length > 1 ? 's' : ''}
                      {eventail.offers.length > MAX_EPINGLES
                        ? ` · ${MAX_EPINGLES} épinglées sur la carte`
                        : ''}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEventail(null)}
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>

              <div className="map-side-list">
                {eventail.offers.map((offer) => (
                  <button
                    key={offer._id}
                    className="map-offer"
                    onClick={() => setOffreActive(offer._id)}
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
                  aller sans chercher l'amas à l'œil. */}
              {tetes.length > 0 && (
                <div className="map-top">
                  <div className="section-label">Les lieux les plus fournis</div>
                  {tetes.map((groupe) => (
                    <button
                      key={groupe.cle}
                      className="map-top-row"
                      onClick={() =>
                        deployer({
                          cle: groupe.cle,
                          lat: groupe.lat,
                          lon: groupe.lon,
                          lieu: groupe.lieu,
                          couleur: groupe.couleur,
                          membres: [groupe],
                        })
                      }
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
                <li>Un amas se sépare en cliquant dessus, ou en zoomant.</li>
                <li>Quand les offres partagent une adresse, elles s'ouvrent en éventail.</li>
                <li>Clic droit maintenu : faire pivoter et incliner la vue.</li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
