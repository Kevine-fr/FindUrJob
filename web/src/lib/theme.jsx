import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Thème de l'interface : clair, sombre ou système, et teinte d'accent.
 *
 * Les deux réglages s'écrivent sur `<html>` en attributs (`data-theme`,
 * `data-accent`) plutôt que dans un contexte lu par chaque composant : la
 * feuille de style les capte seule, donc les trois mille lignes de CSS déjà en
 * place changent de thème sans qu'aucune page soit modifiée.
 *
 * « Système » est résolu ici, pas en CSS. `data-theme` porte toujours une
 * valeur concrète — c'est ce qui permet de n'écrire qu'un seul bloc sombre
 * dans `tokens.css` au lieu de le dupliquer sous une media query.
 */

export const ACCENTS = [
  { value: 'bleu', label: 'Bleu', hue: 210, sat: 66 },
  { value: 'navy', label: 'Navy', hue: 217, sat: 45 },
  { value: 'ardoise', label: 'Ardoise', hue: 215, sat: 22 },
  { value: 'emeraude', label: 'Émeraude', hue: 162, sat: 58 },
  { value: 'ambre', label: 'Ambre', hue: 32, sat: 70 },
  { value: 'violet', label: 'Violet', hue: 263, sat: 45 },
  { value: 'brique', label: 'Brique', hue: 12, sat: 55 },
];

export const MODES = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Système' },
];

const CLE_MODE = 'findurjob:theme';
const CLE_ACCENT = 'findurjob:accent';

const ThemeContext = createContext(null);

/** Le mode réellement appliqué, « système » une fois tranché. */
function resoudre(mode) {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/*
 * Le stockage local jette dans une fenêtre privée verrouillée, et sur un
 * navigateur qui bloque les données de site. Un thème n'est pas une raison
 * d'empêcher l'application de démarrer : on retombe sur les valeurs par défaut.
 */
function lire(cle, defaut) {
  try {
    return window.localStorage.getItem(cle) || defaut;
  } catch {
    return defaut;
  }
}

function ecrire(cle, valeur) {
  try {
    window.localStorage.setItem(cle, valeur);
  } catch {
    /* Réglage perdu au rechargement, rien de plus. */
  }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => lire(CLE_MODE, 'system'));
  const [accent, setAccentState] = useState(() => lire(CLE_ACCENT, 'bleu'));
  const [resolu, setResolu] = useState(() => resoudre(lire(CLE_MODE, 'system')));

  // Applique le mode, et suit le réglage système tant qu'on est en « système ».
  useEffect(() => {
    const requete = window.matchMedia('(prefers-color-scheme: dark)');
    const appliquer = () => {
      const effectif = resoudre(mode);
      setResolu(effectif);
      document.documentElement.dataset.theme = effectif;
      /* La barre système du téléphone suit le fond de la page : sans quoi une
         encoche claire surplombe une application sombre. */
      const couleur = getComputedStyle(document.documentElement)
        .getPropertyValue('--paper')
        .trim();
      for (const balise of document.querySelectorAll('meta[name="theme-color"]')) {
        balise.remove();
      }
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = couleur;
      document.head.appendChild(meta);
    };

    appliquer();
    if (mode !== 'system') return undefined;
    requete.addEventListener('change', appliquer);
    return () => requete.removeEventListener('change', appliquer);
  }, [mode, accent]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const setMode = useCallback((valeur) => {
    setModeState(valeur);
    ecrire(CLE_MODE, valeur);
  }, []);

  const setAccent = useCallback((valeur) => {
    setAccentState(valeur);
    ecrire(CLE_ACCENT, valeur);
  }, []);

  const valeur = useMemo(
    () => ({ mode, resolu, accent, setMode, setAccent }),
    [mode, resolu, accent, setMode, setAccent]
  );

  return <ThemeContext.Provider value={valeur}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const contexte = useContext(ThemeContext);
  if (!contexte) throw new Error('useTheme doit être appelé sous <ThemeProvider>');
  return contexte;
}
