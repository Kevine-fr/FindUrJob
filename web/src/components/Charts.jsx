import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Graphiques, en SVG écrit à la main.
 *
 * Pas de bibliothèque : les formes utilisées ici (aire, barres, anneau) tiennent
 * en quelques dizaines de lignes, et l'écrire nous laisse la main sur
 * l'animation et sur les jetons de couleur du produit.
 *
 * Palette catégorielle validée avec l'outil du projet (bande de clarté, plancher
 * de chroma, séparation daltonienne, contraste). Le contrôle de contraste
 * signale les slots clairs : ils sont donc **toujours étiquetés**, jamais
 * identifiés par la couleur seule.
 */

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];

/** Compte jusqu'à `value` : un chiffre qui s'installe se lit mieux qu'un chiffre posé. */
function useCountUp(value, duration = 900) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const depart = from.current;
    const ecart = value - depart;
    if (!ecart) return undefined;

    // Respecte le réglage système : personne ne doit subir une animation.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = value;
      setShown(value);
      return undefined;
    }

    let frame;
    const debut = performance.now();
    const avance = (t) => {
      const p = Math.min(1, (t - debut) / duration);
      // Sortie douce : la valeur ralentit en approchant, comme un compteur réel.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(depart + ecart * eased));
      if (p < 1) frame = requestAnimationFrame(avance);
      else from.current = value;
    };
    frame = requestAnimationFrame(avance);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}

/** Tuile de statistique. Un nombre isolé n'a pas besoin d'un graphique. */
export function Stat({ label, value, hint, suffix = '', tone }) {
  const shown = useCountUp(Number(value) || 0);
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {shown.toLocaleString('fr-FR')}
        {suffix && <span className="stat-suffix">{suffix}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 34 };

/**
 * Série temporelle en aire.
 *
 * Une seule série : pas de légende (le titre la nomme), mais un repère au
 * survol — un graphique HTML sans survol perd la valeur exacte.
 */
export function AreaChart({ data, color = SERIES[0], label }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const { d, aire, points, max } = useMemo(() => {
    const valeurs = data.map((p) => p.value);
    const max = Math.max(1, ...valeurs);
    const largeur = W - PAD.left - PAD.right;
    const hauteur = H - PAD.top - PAD.bottom;

    const points = data.map((p, i) => ({
      ...p,
      x: PAD.left + (data.length === 1 ? largeur / 2 : (i / (data.length - 1)) * largeur),
      y: PAD.top + hauteur - (p.value / max) * hauteur,
    }));

    const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const base = PAD.top + hauteur;
    const aire = `${d} L${points.at(-1).x.toFixed(1)} ${base} L${points[0].x.toFixed(1)} ${base} Z`;
    return { d, aire, points, max };
  }, [data]);

  const survol = (event) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    // Le point le plus proche, et non celui sous le curseur : la cible de survol
    // doit être plus large que la marque.
    let proche = points[0];
    for (const p of points) if (Math.abs(p.x - x) < Math.abs(proche.x - x)) proche = p;
    setHover(proche);
  };

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={survol}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${label} — ${data.length} jours, maximum ${max}`}
      >
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grille discrète : trois repères suffisent à situer une valeur. */}
        {[0, 0.5, 1].map((f) => {
          const y = PAD.top + (H - PAD.top - PAD.bottom) * f;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className="grid" />
              <text x={4} y={y + 3} className="axis">
                {Math.round(max * (1 - f))}
              </text>
            </g>
          );
        })}

        <path d={aire} fill={`url(#grad-${label})`} className="area-fill" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" className="area-line" />

        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="crosshair"
            />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill={color} className="marker" />
          </>
        )}
      </svg>

      {hover && (
        <div className="chart-tip" style={{ left: `${(hover.x / W) * 100}%` }}>
          <strong>{hover.value}</strong>
          <span>{new Date(hover.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Barres horizontales : la forme qui supporte des libellés longs, là où des
 * barres verticales les forceraient à pivoter.
 */
export function BarList({ data, labels = {}, color = SERIES[0], empty = 'Aucune donnée' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="muted chart-empty">{empty}</p>;

  return (
    <div className="barlist">
      {data.map((item, index) => (
        <div className="bar-row" key={item.key} style={{ '--i': index }}>
          <span className="bar-label">{labels[item.key] || item.key}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(item.value / max) * 100}%`, background: color }}
            />
          </span>
          <span className="bar-value">{item.value.toLocaleString('fr-FR')}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Anneau de répartition.
 *
 * Chaque part est étiquetée à côté : le contrôle de contraste de la palette
 * signale des slots clairs, l'identité ne peut donc pas reposer sur la couleur
 * seule. Un écart de 2 px sépare les segments.
 */
export function Donut({ data, labels = {}, empty = 'Aucune donnée' }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!total) return <p className="muted chart-empty">{empty}</p>;

  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Répartition">
        <g transform="translate(70 70) rotate(-90)">
          {data.map((item, index) => {
            const part = item.value / total;
            const longueur = Math.max(0, part * C - 2); // 2 px d'écart entre parts
            const dash = `${longueur} ${C - longueur}`;
            const decalage = -offset * C;
            offset += part;
            return (
              <circle
                key={item.key}
                r={R}
                fill="none"
                stroke={SERIES[index % SERIES.length]}
                strokeWidth="18"
                strokeDasharray={dash}
                strokeDashoffset={decalage}
                className="donut-part"
                style={{ '--i': index }}
              />
            );
          })}
        </g>
        <text x="70" y="66" className="donut-total">
          {total.toLocaleString('fr-FR')}
        </text>
        <text x="70" y="84" className="donut-unit">
          au total
        </text>
      </svg>

      <ul className="legend">
        {data.map((item, index) => (
          <li key={item.key}>
            <span className="dot" style={{ background: SERIES[index % SERIES.length] }} />
            <span className="legend-label">{labels[item.key] || item.key}</span>
            <span className="legend-value">
              {item.value.toLocaleString('fr-FR')} · {Math.round((item.value / total) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
