/**
 * Ce que la plateforme dit avoir reçu.
 *
 * Une candidature envoyée ne laisse pas toujours de trace lisible : la page de
 * confirmation varie, s'affiche parfois dans une modale qui se referme, et le
 * texte change au gré des refontes. Conclure depuis cette seule phrase menait à
 * des « à vérifier » et des « envoi échoué » en masse — alors que la plateforme,
 * elle, avait bel et bien enregistré la candidature. Constaté en vrai : 260
 * candidatures listées côté HelloWork, 424 côté LinkedIn, et deux seulement
 * marquées « Postulé » dans l'application.
 *
 * Le remède est d'aller le lui demander. Chaque plateforme tient une liste de
 * « mes candidatures » : c'est elle qui fait foi, pas ce que le formulaire a
 * bien voulu afficher au moment de l'envoi.
 */

import { humanPause } from './common.js';

/**
 * Clé de rapprochement entre une candidature listée et une offre en base.
 *
 * Aucune plateforme ne redonne l'identifiant de l'offre dans cette liste — elles
 * y mettent l'identifiant de *la candidature*. Il faut donc rapprocher sur ce
 * qui est affiché, en neutralisant tout ce qui varie d'un affichage à l'autre :
 * accents, casse, mentions « H/F », ponctuation, espaces multiples.
 */
export function cleRapprochement(titre, societe = '') {
  const nettoyer = (texte) =>
    String(texte || '')
      .normalize('NFD')
      // Les diacritiques, écrits par leur code : un intervalle littéral survit
      // mal aux copies de fichier et donnerait une expression fausse en silence.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\((?:h\/f|f\/h|h-f|f-h|m\/f)\)|\b(?:h\/f|f\/h|h-f|f-h|m\/f|w\/m)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  return `${nettoyer(titre)}|${nettoyer(societe)}`;
}

/**
 * Les blocs d'une liste, rendus en lignes de texte.
 *
 * On lit la structure, jamais les classes : celles de LinkedIn comme de Welcome
 * to the Jungle sont des empreintes régénérées à chaque déploiement, et s'y
 * accrocher reviendrait à réécrire ce lecteur tous les mois.
 *
 * Le sélecteur reste propre à chaque plateforme parce qu'il n'existe pas de
 * règle générale fiable : une carte HelloWork est un `article` qui contient
 * lui-même des `li` (ses étiquettes de lieu et de contrat), si bien qu'une
 * heuristique du genre « le bloc le plus interne » y attraperait les étiquettes
 * au lieu de la candidature.
 */
export async function lireBlocs(page, selecteur, { lignesMini = 2 } = {}) {
  return page.evaluate(
    ([sel, mini]) => {
      const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

      return [...document.querySelectorAll(sel)]
        .filter(visible)
        .map((el) => ({
          lignes: (el.innerText || '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
          lien: el.querySelector('a[href]')?.getAttribute('href') || '',
        }))
        .filter((bloc) => bloc.lignes.length >= mini);
    },
    [selecteur, lignesMini]
  );
}

/** Fait défiler jusqu'à ce que la liste cesse de s'allonger. */
export async function deroulerListe(page, { tours = 6 } = {}) {
  let precedent = 0;
  for (let i = 0; i < tours; i += 1) {
    const hauteur = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
    await humanPause(900, 1500);
    if (hauteur === precedent) break;
    precedent = hauteur;
  }
}
