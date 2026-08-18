import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildCvDocument } from '../lib/cvTemplate.js';

const A4_PX = { width: 794, height: 1123 }; // 210 × 297 mm à 96 dpi

/**
 * Aperçu de la page A4.
 *
 * Le CV est rendu dans une iframe, avec exactement le document envoyé à
 * l'impression : ce qui est affiché ici *est* le PDF, pas une approximation.
 * L'iframe se met elle-même à la bonne densité et publie son bilan, qu'on
 * relit au chargement pour afficher le taux de remplissage.
 */
export default function CvPreview({ profile, options, onFit }) {
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const [html, setHtml] = useState('');

  /*
   * Un seul aperçu, un seul gabarit.
   *
   * Un temps, un CV importé s’affichait tel quel dans un second cadre : deux
   * documents rivaux, deux mises en page, et une candidature dont on ne savait
   * plus laquelle partirait. L’import alimente désormais les rubriques (après
   * confirmation), et l’aperçu reste ce qu’il a toujours été — le CV composé
   * ici, avec les données du moment.
   */

  // Recomposer à chaque frappe saccade l'aperçu : on laisse la frappe se poser.
  useEffect(() => {
    const timer = setTimeout(() => setHtml(buildCvDocument(profile, options)), 220);
    return () => clearTimeout(timer);
  }, [profile, options]);

  // La feuille est rendue à sa taille réelle puis mise à l'échelle du panneau :
  // une iframe ne peut pas être « responsive » de l'intérieur.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const fit = () => {
      const scale = stage.clientWidth / A4_PX.width;
      stage.style.setProperty('--scale', String(scale));
    };
    fit();

    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // srcDoc reste sur la même origine : on peut lire le bilan que le document
  // a publié pour lui-même.
  const readFit = () => {
    try {
      const result = frameRef.current?.contentWindow?.__cvFit;
      if (result && onFit) onFit(result);
    } catch {
      /* origine inattendue : l'aperçu reste affiché, sans jauge */
    }
  };

  return (
    <div className="sheet-stage" ref={stageRef}>
      <iframe
        ref={frameRef}
        className="sheet-frame"
        title="Aperçu du CV"
        srcDoc={html}
        onLoad={readFit}
        width={A4_PX.width}
        height={A4_PX.height}
        // L'aperçu n'a besoin que de ses propres scripts : pas de navigation,
        // pas de formulaire, pas d'accès au parent.
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
