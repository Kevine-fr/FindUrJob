import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildCvDocument } from '../lib/cvTemplate.js';
import { API_BASE } from '../api/client.js';

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
   * Deux origines possibles pour l’aperçu.
   *
   * Un CV importé est un document fini : c’est lui qui partira en candidature,
   * donc c’est lui qu’on montre. L’aperçu restait jusqu’ici figé sur les
   * rubriques du formulaire, si bien qu’un import ne changeait rien à l’écran.
   *
   * Dès qu’une rubrique est renseignée, le CV composé reprend la main : c’est
   * le signe que la personne construit son CV ici plutôt que d’en déposer un.
   */
  const composeIci =
    (profile?.experiences?.length || 0) > 0 ||
    (profile?.education?.length || 0) > 0 ||
    (profile?.skillGroups?.length || 0) > 0;

  const fichierImporte = Boolean(profile?.cvFileName) && !composeIci;

  // Recomposer à chaque frappe saccade l'aperçu : on laisse la frappe se poser.
  useEffect(() => {
    if (fichierImporte) return undefined;
    const timer = setTimeout(() => setHtml(buildCvDocument(profile, options)), 220);
    return () => clearTimeout(timer);
  }, [profile, options, fichierImporte]);

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

  /*
   * Le branchement se fait ici, après tous les hooks.
   *
   * Placé plus haut, le retour anticipé aurait sauté `useLayoutEffect` : React
   * compte les hooks à chaque rendu, et en passant d'un CV importé à un CV
   * composé il aurait levé « Rendered fewer hooks than expected ».
   */
  return (
    <div className="sheet-stage" ref={stageRef}>
      {fichierImporte ? (
        <iframe
          className="sheet-frame"
          title="CV importé"
          // L'horodatage force le rechargement après un nouvel import : sans lui,
          // le navigateur resservait le fichier précédent depuis son cache.
          src={`${API_BASE}/profile/cv-file?v=${profile.cvUploadedAt || ''}`}
          width={A4_PX.width}
          height={A4_PX.height}
        />
      ) : (
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
      )}
    </div>
  );
}
