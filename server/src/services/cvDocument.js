/**
 * Le CV reciblé, en document imprimable.
 *
 * Le moteur IA rend du Markdown ; les plateformes veulent un PDF. Ce module
 * fait le pont : Markdown → HTML autonome → (service `bot`) → PDF.
 *
 * Volontairement en une seule colonne, sans fioriture : ce document part dans
 * un formulaire de candidature et sera lu par un ATS avant de l'être par un
 * humain. La lisibilité machine prime sur l'effet.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Gras, italique et liens : le strict nécessaire pour un CV. */
function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Markdown → HTML.
 *
 * On ne traite que ce que `rendering.py` et les modèles produisent réellement :
 * titres, listes à puces, paragraphes. Un analyseur complet serait du poids mort.
 */
function markdownToHtml(markdown) {
  const lignes = String(markdown || '').split('\n');
  const sortie = [];
  let dansListe = false;

  const fermerListe = () => {
    if (dansListe) {
      sortie.push('</ul>');
      dansListe = false;
    }
  };

  for (const brute of lignes) {
    const ligne = brute.trimEnd();

    if (!ligne.trim()) {
      fermerListe();
      continue;
    }

    const titre = /^(#{1,4})\s+(.*)$/.exec(ligne);
    if (titre) {
      fermerListe();
      const niveau = titre[1].length;
      sortie.push(`<h${niveau}>${inline(titre[2])}</h${niveau}>`);
      continue;
    }

    const puce = /^[-*]\s+(.*)$/.exec(ligne.trim());
    if (puce) {
      if (!dansListe) {
        sortie.push('<ul>');
        dansListe = true;
      }
      sortie.push(`<li>${inline(puce[1])}</li>`);
      continue;
    }

    // Citation Markdown : sert aux avertissements du mode hors-ligne.
    const citation = /^>\s?(.*)$/.exec(ligne.trim());
    if (citation) {
      fermerListe();
      sortie.push(`<p class="note">${inline(citation[1])}</p>`);
      continue;
    }

    fermerListe();
    sortie.push(`<p>${inline(ligne.trim())}</p>`);
  }

  fermerListe();
  return sortie.join('\n');
}

const STYLES = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
@page{size:A4;margin:0}
.page{width:210mm;min-height:297mm;padding:16mm 18mm;
  font-family:Inter,'Helvetica Neue',Helvetica,Arial,'Liberation Sans',sans-serif;
  font-size:10.4pt;line-height:1.45;color:#15161c;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:1.9em;font-weight:800;letter-spacing:-.02em;margin:0 0 .15em}
h2{font-size:.92em;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
  margin:1.25em 0 .5em;padding-bottom:.22em;border-bottom:1.5px solid #15161c}
h3{font-size:1em;font-weight:700;margin:.85em 0 .1em}
h4{font-size:.9em;font-weight:700;margin:.6em 0 .1em}
p{margin:.3em 0}
em{font-style:normal;color:#5c6172}
ul{margin:.25em 0 .5em;padding-left:1.05em}
li{margin-bottom:.14em}
li::marker{color:var(--accent,#2d5bff)}
a{color:var(--accent,#2d5bff);text-decoration:none}
.note{color:#5c6172;font-size:.9em;border-left:2px solid #dcdfe6;padding-left:.6em}

/* Deux colonnes : bande latérale pour ce qui se balaie, colonne principale
   pour ce qui se lit. Le rapport 1/2,4 laisse au parcours la place qu'il
   mérite sans étrangler les compétences. */
.grille{display:grid;grid-template-columns:1fr 2.4fr;gap:0 9mm;margin-top:1em}
.cote{border-right:1px solid #e6e3da;padding-right:8mm}
.principal{min-width:0}

/* Dans la bande, les titres sont plus discrets et les listes sans puces :
   une colonne étroite se lit mieux en colonnes de mots qu'en liste à points. */
.cote h2{font-size:.8em;border-bottom-width:1px;margin-top:1em}
.cote h2:first-child{margin-top:0}
.cote ul{list-style:none;padding-left:0}
.cote li{margin-bottom:.2em}
.cote p{font-size:.95em}

/* L'en-tête coiffe les deux colonnes. */
.entete{margin-bottom:.2em}
.entete p{color:#5c6172}
`;

/**
 * Construit le document du CV reciblé.
 * @param {string} markdown  Le CV rendu par le moteur IA.
 * @param {object} [options] `accent` : couleur reprise du profil.
 */
/**
 * Les rubriques qui vont en colonne de gauche.
 *
 * Ce sont les listes courtes et scannables — un recruteur les balaie, il ne les
 * lit pas. Tout le reste (parcours, projets, formation) tient la colonne
 * principale, qui se lit en continu.
 */
const RUBRIQUES_COTE = /^(comp[ée]tences|langues|liens|contact|centres? d'int[ée]r[êe]t|certifications|outils)/i;

/**
 * Répartit les sections `## …` entre la colonne latérale et la principale.
 *
 * L'en-tête (avant le premier `##`) reste en pleine largeur : le nom et les
 * coordonnées coiffent le document, ils n'appartiennent à aucune colonne.
 */
function repartir(markdown) {
  const blocs = String(markdown || '').split(/\n(?=## )/);
  const entete = blocs.shift() || '';
  const cote = [];
  const principal = [];

  for (const bloc of blocs) {
    const titre = (/^##\s+(.+)$/m.exec(bloc)?.[1] || '').trim();
    (RUBRIQUES_COTE.test(titre) ? cote : principal).push(bloc);
  }

  return { entete, cote: cote.join('\n'), principal: principal.join('\n') };
}

export function buildTailoredCvHtml(markdown, { accent = '#2d5bff' } = {}) {
  const couleur = /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#2d5bff';
  const { entete, cote, principal } = repartir(markdown);

  /*
   * Deux colonnes, comme le CV maître.
   *
   * Le document partait sur une seule colonne : le CV reciblé ne ressemblait
   * plus au CV de référence, et la liste des compétences s'étalait sur toute la
   * largeur au lieu de tenir dans une bande latérale. Quand aucune rubrique ne
   * relève de la colonne latérale, on retombe sur une colonne pleine plutôt que
   * d'imprimer une bande vide.
   */
  const corps = cote
    ? `<div class="grille">
<aside class="cote">${markdownToHtml(cote)}</aside>
<main class="principal">${markdownToHtml(principal)}</main>
</div>`
    : markdownToHtml(principal);

  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>CV</title><style>${STYLES}</style></head>
<body><div class="page" style="--accent:${esc(couleur)}">
<header class="entete">${markdownToHtml(entete)}</header>
${corps}
</div></body></html>`;
}

export const __test = { markdownToHtml, inline };
