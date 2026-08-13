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
`;

/**
 * Construit le document du CV reciblé.
 * @param {string} markdown  Le CV rendu par le moteur IA.
 * @param {object} [options] `accent` : couleur reprise du profil.
 */
export function buildTailoredCvHtml(markdown, { accent = '#2d5bff' } = {}) {
  const couleur = /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#2d5bff';
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>CV</title><style>${STYLES}</style></head>
<body><div class="page" style="--accent:${esc(couleur)}">
${markdownToHtml(markdown)}
</div></body></html>`;
}

export const __test = { markdownToHtml, inline };
