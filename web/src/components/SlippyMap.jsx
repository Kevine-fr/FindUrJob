import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Carte glissante, sans dépendance.
 *
 * Une carte tuilée tient en une projection et deux gestes : Leaflet ferait la
 * même chose, mais au prix d'un paquet npm à installer dans le conteneur — et
 * l'onglet resterait cassé tant que l'installation n'a pas tourné. Ici, le
 * composant fonctionne dès que le fichier est enregistré.
 *
 * Les tuiles viennent d'OpenStreetMap. Leur usage impose de citer la source
 * (le bandeau en bas à droite) et de ne pas les aspirer en masse : on n'affiche
 * que ce qui est à l'écran, ce que fait n'importe quelle carte.
 */

const TAILLE = 256; // côté d'une tuile, en pixels
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 18;

// Web Mercator : au-delà de ±85°, la projection part à l'infini.
const LAT_MAX = 85.05112878;

const borner = (valeur, min, max) => Math.min(max, Math.max(min, valeur));

/** Longitude → abscisse, en nombre de tuiles au zoom donné. */
export function lonToX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

/** Latitude → ordonnée, en nombre de tuiles au zoom donné. */
export function latToY(lat, zoom) {
  const rad = (borner(lat, -LAT_MAX, LAT_MAX) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

function xToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180;
}

function yToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Vue englobant un ensemble de points.
 *
 * Sans cela, une carte centrée sur la France afficherait un continent vide
 * quand toutes les offres sont à Lyon — ou couperait la moitié des marqueurs
 * quand elles sont réparties sur l'Europe.
 */
export function cadrer(points, largeur = 900, hauteur = 560) {
  // Aucun point : la France entière, faute de mieux à montrer.
  if (!points.length) return { lat: 46.6, lon: 2.4, zoom: 5 };

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const centre = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };

  // Un point unique n'a pas d'étendue : on choisit un zoom de ville.
  if (points.length === 1) return { ...centre, zoom: 11 };

  // Du plus serré au plus large : le premier zoom qui laisse tout entrer gagne.
  // La marge évite qu'un marqueur touche le bord, où il serait illisible.
  for (let zoom = ZOOM_MAX; zoom >= ZOOM_MIN; zoom -= 1) {
    const dx = (lonToX(Math.max(...lons), zoom) - lonToX(Math.min(...lons), zoom)) * TAILLE;
    const dy = (latToY(Math.min(...lats), zoom) - latToY(Math.max(...lats), zoom)) * TAILLE;
    if (dx <= largeur - 120 && dy <= hauteur - 120) return { ...centre, zoom };
  }

  return { ...centre, zoom: ZOOM_MIN };
}

/**
 * `view` : { lat, lon, zoom }. `children` est une fonction qui reçoit de quoi
 * placer ce qu'on veut par-dessus les tuiles — la carte ne connaît pas les
 * offres, elle ne sait que projeter.
 */
export default function SlippyMap({ view, onView, children }) {
  const ref = useRef(null);
  const [taille, setTaille] = useState({ w: 0, h: 0 });
  const geste = useRef(null);
  const [glisse, setGlisse] = useState(false);

  // La projection dépend de la taille réelle du conteneur, qui n'est connue
  // qu'après la mise en page — et change avec la fenêtre.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const mesurer = () =>
      setTaille({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    mesurer();

    const observer = new ResizeObserver(mesurer);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { lat, lon, zoom } = view;
  const echelle = 2 ** zoom;
  const { w, h } = taille;

  // Coin haut-gauche de la vue, en pixels du monde entier.
  const gauche = lonToX(lon, zoom) * TAILLE - w / 2;
  const haut = latToY(lat, zoom) * TAILLE - h / 2;

  /** Pixel de l'écran → coordonnées géographiques. */
  const deviner = useCallback(
    (px, py) => ({
      lat: yToLat((haut + py) / TAILLE, zoom),
      lon: xToLon((gauche + px) / TAILLE, zoom),
    }),
    [gauche, haut, zoom]
  );

  const deplacer = (worldX, worldY) =>
    onView({
      lat: borner(yToLat((worldY + h / 2) / TAILLE, zoom), -LAT_MAX, LAT_MAX),
      lon: xToLon((worldX + w / 2) / TAILLE, zoom),
      zoom,
    });

  const onPointerDown = (event) => {
    // Un clic sur un marqueur ne doit pas devenir un déplacement de carte.
    if (event.target.closest('[data-no-pan]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    geste.current = { x: event.clientX, y: event.clientY, gauche, haut, bouge: false };
    setGlisse(true);
  };

  const onPointerMove = (event) => {
    if (!geste.current) return;
    const dx = event.clientX - geste.current.x;
    const dy = event.clientY - geste.current.y;
    // En deçà de quelques pixels, c'est un clic tremblant, pas un glissement.
    if (!geste.current.bouge && Math.abs(dx) + Math.abs(dy) < 3) return;
    geste.current.bouge = true;
    deplacer(geste.current.gauche - dx + w / 2, geste.current.haut - dy + h / 2);
  };

  const onPointerUp = (event) => {
    if (geste.current) event.currentTarget.releasePointerCapture(event.pointerId);
    geste.current = null;
    setGlisse(false);
  };

  /**
   * Molette : le point sous le curseur ne bouge pas.
   *
   * Zoomer sur le centre de la carte ferait fuir l'endroit qu'on visait, et
   * obligerait à recadrer après chaque cran.
   */
  const onWheel = (event) => {
    if (!w) return;
    const cible = borner(zoom + (event.deltaY < 0 ? 1 : -1), ZOOM_MIN, ZOOM_MAX);
    if (cible === zoom) return;

    const rect = ref.current.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const ancre = deviner(px, py);

    // Au nouveau zoom, on replace le centre pour que l'ancre retombe au même
    // pixel de l'écran.
    const gx = lonToX(ancre.lon, cible) * TAILLE - px;
    const gy = latToY(ancre.lat, cible) * TAILLE - py;
    onView({
      lat: borner(yToLat((gy + h / 2) / TAILLE, cible), -LAT_MAX, LAT_MAX),
      lon: xToLon((gx + w / 2) / TAILLE, cible),
      zoom: cible,
    });
  };

  /*
   * La molette doit être écoutée en non-passif pour pouvoir empêcher le
   * défilement de la page : React pose ses écouteurs `onWheel` en passif, où
   * `preventDefault()` est ignoré.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const stop = (event) => event.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  // Tuiles visibles. Tant que la taille est inconnue, on n'en calcule aucune :
  // les bornes seraient absurdes et on demanderait des milliers d'images.
  const tuiles = [];
  if (w > 0 && h > 0) {
    const x0 = Math.floor(gauche / TAILLE);
    const x1 = Math.floor((gauche + w) / TAILLE);
    const y0 = Math.max(0, Math.floor(haut / TAILLE));
    const y1 = Math.min(echelle - 1, Math.floor((haut + h) / TAILLE));

    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        // Le monde se répète horizontalement : la tuile -1 est la dernière.
        const xw = ((x % echelle) + echelle) % echelle;
        tuiles.push({
          cle: `${zoom}/${x}/${y}`,
          url: `https://tile.openstreetmap.org/${zoom}/${xw}/${y}.png`,
          left: Math.round(x * TAILLE - gauche),
          top: Math.round(y * TAILLE - haut),
        });
      }
    }
  }

  /**
   * Coordonnées → pixel de l'écran, en choisissant la copie du monde la plus
   * proche de la vue (sinon un marqueur sort de l'écran dès qu'on franchit
   * l'antiméridien, ou quand la carte est dézoomée et répétée).
   */
  const projeter = (pLat, pLon) => {
    const largeurMonde = echelle * TAILLE;
    let x = lonToX(pLon, zoom) * TAILLE - gauche;
    while (x < -largeurMonde / 2) x += largeurMonde;
    while (x > w + largeurMonde / 2) x -= largeurMonde;
    return { x, y: latToY(pLat, zoom) * TAILLE - haut };
  };

  const zoomer = (pas) =>
    onView({ ...view, zoom: borner(zoom + pas, ZOOM_MIN, ZOOM_MAX) });

  return (
    <div
      ref={ref}
      className={'slippy' + (glisse ? ' is-dragging' : '')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div className="slippy-tiles">
        {tuiles.map((tuile) => (
          <img
            key={tuile.cle}
            src={tuile.url}
            alt=""
            width={TAILLE}
            height={TAILLE}
            loading="lazy"
            draggable={false}
            style={{ left: tuile.left, top: tuile.top }}
          />
        ))}
      </div>

      <div className="slippy-overlay">
        {w > 0 && children({ projeter, zoom, largeur: w, hauteur: h })}
      </div>

      <div className="slippy-zoom" data-no-pan>
        <button className="btn btn-sm" onClick={() => zoomer(1)} aria-label="Zoomer">
          +
        </button>
        <button className="btn btn-sm" onClick={() => zoomer(-1)} aria-label="Dézoomer">
          −
        </button>
      </div>

      {/* Mention obligatoire pour utiliser les tuiles d'OpenStreetMap. */}
      <a
        className="slippy-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        data-no-pan
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
