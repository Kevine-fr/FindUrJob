/**
 * La lettre de motivation, en document imprimable.
 *
 * Elle était la seule pièce du dossier qu'on ne pouvait pas voir telle qu'elle
 * part : le CV avait son PDF, la lettre restait un bloc de texte à l'écran. Or
 * c'est ce document que le recruteur reçoit — le relire dans sa mise en page
 * réelle est le seul moyen de vérifier ce qu'on envoie.
 *
 * Une page A4, une seule colonne, des marges de courrier : rien à ajuster, la
 * lettre est courte par construction (250 mots au plus).
 */

const echapper = (texte = '') =>
  String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function buildLetterHtml(lettre, { candidat = '', offre = '' } = {}) {
  const corps = echapper(lettre)
    .split(/\n{2,}/)
    .map((bloc) => `<p>${bloc.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Lettre — ${echapper(offre) || 'candidature'}</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }

  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  body {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11.5pt;
    /* Interligne de courrier : plus aéré qu'un CV, la lettre se lit d'un trait. */
    line-height: 1.6;
    color: #16171d;
  }

  p { margin: 0 0 12pt; text-align: justify; }

  /* L'objet ouvre la lettre : il se détache sans crier. */
  p:first-child {
    font-weight: bold;
    text-align: left;
    margin-bottom: 18pt;
  }

  /* La formule de politesse et la signature ne se séparent pas de ce qui
     précède : une lettre coupée juste avant « Cordialement » fait négligé. */
  p:last-child, p:nth-last-child(2) { page-break-inside: avoid; }
</style>
</head>
<body>
${corps}
</body>
</html>`;
}
