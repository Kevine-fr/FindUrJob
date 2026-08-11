/**
 * Le CV, en un document HTML autonome.
 *
 * Une seule fonction produit le document, et il sert deux fois : l'aperçu le
 * charge dans une iframe, le service `bot` le charge dans Chromium pour en
 * tirer un PDF. Rien n'est chargé de l'extérieur (police, image, script) : le
 * rendu est donc identique hors-ligne, et reproductible.
 *
 * L'ajustement à une page est embarqué *dans* le document (voir FIT_SCRIPT).
 * C'est volontaire : l'aperçu et le PDF n'ont pas les mêmes polices, donc pas
 * les mêmes hauteurs de ligne. Chacun mesure chez lui, avec le même algorithme.
 */

// --- Échappement --------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Une URL d'image sûre : on n'accepte que le data URI, jamais un appel réseau. */
const safePhoto = (value) => (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value || '') ? value : '');

/** Une URL de lien : http(s) ou mailto/tel uniquement. */
const safeHref = (value) => {
  const url = String(value || '').trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : '';
};

/** L'URL telle qu'on l'affiche : sans le protocole ni le slash final. */
const prettyUrl = (value) =>
  String(value || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

// --- Icônes (inline, pour rester autonome) ------------------------------

const ICON = {
  mail: '<path d="M2 4h12v8H2z" fill="none"/><path d="M2 4.5 8 9l6-4.5"/>',
  phone: '<path d="M3 3h3l1.5 3.5-2 1a9 9 0 0 0 4 4l1-2L14 11v3h-1A10.5 10.5 0 0 1 3 4z"/>',
  pin: '<path d="M8 14s5-4.2 5-8A5 5 0 0 0 3 6c0 3.8 5 8 5 8z"/><circle cx="8" cy="6" r="1.8"/>',
  link: '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1"/>',
  calendar:
    '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  building: '<path d="M3 14V3h7v11M10 7h3v7M5 5.5h3M5 8h3M5 10.5h3"/>',
  award: '<circle cx="8" cy="6" r="3.5"/><path d="M5.8 9.2 5 14l3-1.6L11 14l-.8-4.8"/>',
  globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c3 3.5 3 7.5 0 11-3-3.5-3-7.5 0-11z"/>',
  code: '<path d="M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3"/>',
};

const icon = (name) =>
  `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

const LINK_ICON = { linkedin: 'link', github: 'code', portfolio: 'globe', autre: 'link' };

// --- Normalisation du profil -------------------------------------------

/** Les puces d'une entrée, ou le paragraphe découpé ligne à ligne. */
const factsOf = (entry) => {
  const bullets = (entry?.bullets || []).map((line) => String(line).trim()).filter(Boolean);
  if (bullets.length) return bullets;
  return String(entry?.description || '')
    .split('\n')
    .map((line) => line.replace(/^[-•*\s]+/, '').trim())
    .filter(Boolean);
};

const joinDots = (...bits) => bits.filter(Boolean).join(' · ');

/**
 * Rassemble les compétences en familles.
 * Un profil peut n'avoir que la liste à plat (ancien format) : elle devient
 * alors une famille sans titre, plutôt que de disparaître du rendu.
 */
function skillFamilies(profile) {
  const groups = (profile.skillGroups || [])
    .map((group) => ({
      label: String(group?.label || '').trim(),
      items: (group?.items || []).map((item) => String(item).trim()).filter(Boolean),
    }))
    .filter((group) => group.items.length);

  const loose = (profile.skills || []).map((item) => String(item).trim()).filter(Boolean);
  if (loose.length) groups.push({ label: groups.length ? 'Autres' : '', items: loose });
  return groups;
}

// --- Blocs de rendu -----------------------------------------------------

/**
 * Échelle de sacrifice, du moins regrettable au plus regrettable.
 *
 * Le script d'ajustement masque les éléments par `data-trim` décroissant. La
 * règle : on perd d'abord de la redondance (la 9e techno d'une famille), puis
 * du détail, et seulement en dernier recours une entrée entière — et jamais
 * les deux premières expériences, qui sont le CV.
 */
const TRIM = {
  skillOverflow: 300, // compétences au-delà de la 8e d'une famille
  deepBullet: 200, // puces au-delà de la 3e
  extraCert: 150, // certifications au-delà de la 2e
  eduDetail: 140,
  skillExtra: 120, // compétences de la 5e à la 8e
  secondBullet: 100, // 2e puce d'une entrée
  wholeProject: 60,
  wholeExperience: 20, // uniquement à partir de la 5e expérience
};

const sideSection = (title, body) =>
  body ? `<section class="blk"><h2 class="side-h">${esc(title)}</h2>${body}</section>` : '';

const mainSection = (title, body) =>
  body ? `<section class="blk"><h2 class="main-h">${esc(title)}</h2>${body}</section>` : '';

function contactBlock(profile) {
  const rows = [
    profile.email && { name: 'mail', text: profile.email, href: `mailto:${profile.email}` },
    profile.phone && { name: 'phone', text: profile.phone, href: `tel:${profile.phone}` },
    profile.location && { name: 'pin', text: profile.location },
  ].filter(Boolean);

  if (!rows.length) return '';
  return `<ul class="contact">${rows
    .map((row) => {
      const href = safeHref(row.href);
      const label = esc(row.text);
      const text = href ? `<a href="${esc(href)}">${label}</a>` : label;
      return `<li>${icon(row.name)}<span>${text}</span></li>`;
    })
    .join('')}</ul>`;
}

function skillsBlock(profile) {
  const families = skillFamilies(profile);
  if (!families.length) return '';

  return families
    .map((family, familyIndex) => {
      // Pas de `data-trim` ici : retirer un intitulé de famille laisserait ses
      // puces orphelines sous la famille précédente.
      const label = family.label ? `<div class="fam">${esc(family.label)}</div>` : '';

      // Les quatre premières compétences d'une famille restent ; au-delà, elles
      // deviennent la matière la moins coûteuse à sacrifier.
      const chips = family.items
        .map((item, index) => {
          if (index < 4) return `<span class="chip">${esc(item)}</span>`;
          const base = index >= 8 ? TRIM.skillOverflow : TRIM.skillExtra;
          const priority = base + familyIndex * 10 + Math.min(index, 9);
          return `<span class="chip" data-trim="${priority}">${esc(item)}</span>`;
        })
        .join('');
      return `${label}<div class="chips">${chips}</div>`;
    })
    .join('');
}

function linksBlock(profile) {
  const links = (profile.links || []).filter((link) => safeHref(link?.url));
  if (!links.length) return '';

  return `<ul class="links">${links
    .map((link) => {
      const href = safeHref(link.url);
      const shown = link.label?.trim() || prettyUrl(href);
      return `<li>${icon(LINK_ICON[link.type] || 'link')}<a href="${esc(href)}">${esc(shown)}</a></li>`;
    })
    .join('')}</ul>`;
}

function languagesBlock(profile) {
  const languages = (profile.languages || []).filter((lang) => lang?.name);
  if (!languages.length) return '';

  return `<ul class="langs">${languages
    .map(
      (lang) =>
        `<li>${icon('globe')}<span><strong>${esc(lang.name)}</strong>${
          lang.level ? ` : ${esc(lang.level)}` : ''
        }</span></li>`
    )
    .join('')}</ul>`;
}

function certificationsBlock(profile) {
  const certs = (profile.certifications || []).filter((cert) => cert?.name);
  if (!certs.length) return '';

  // Les deux premières certifications restent : au-delà, c'est de l'accumulation.
  return `<ul class="certs">${certs
    .map((cert, index) => {
      const trim = index >= 2 ? ` data-trim="${TRIM.extraCert + index}"` : '';
      return (
        `<li${trim}>${icon('award')}<span><strong>${esc(cert.name)}</strong>` +
        `<em>${esc(joinDots(cert.issuer, cert.date))}</em></span></li>`
      );
    })
    .join('')}</ul>`;
}

/**
 * Une entrée de parcours (expérience ou projet).
 *
 * `rank` situe l'entrée dans sa rubrique : il sert à décider quoi sacrifier en
 * premier si le CV déborde — les puces des postes les plus anciens.
 */
function entryBlock(entry, rank, { titleKey = 'role', kind = 'experience' } = {}) {
  const title = String(entry[titleKey] || entry.role || entry.name || '').trim();
  const facts = factsOf(entry);

  const meta = [
    entry.company && `${icon('building')}<span class="org">${esc(entry.company)}</span>`,
    entry.location && `${icon('pin')}<span>${esc(entry.location)}</span>`,
    entry.period && `${icon('calendar')}<span>${esc(entry.period)}</span>`,
  ].filter(Boolean);

  // Le premier fait est intouchable : sans lui, l'entrée ne dit plus rien.
  const bullets = facts
    .map((fact, index) => {
      if (index === 0) return `<li>${esc(fact)}</li>`;
      const base = index >= 3 ? TRIM.deepBullet : index >= 2 ? TRIM.deepBullet - 40 : TRIM.secondBullet;
      return `<li data-trim="${base + rank * 5 + Math.min(index, 9)}">${esc(fact)}</li>`;
    })
    .join('');

  // Dernier recours : l'entrée entière. Un projet est toujours sacrifiable ;
  // une expérience ne l'est qu'à partir de la cinquième, jamais avant.
  let entryTrim = '';
  if (kind === 'project') entryTrim = ` data-trim="${TRIM.wholeProject + rank}"`;
  // `+ rank` et non l'inverse : la plus ancienne (rang le plus élevé) part la première.
  else if (rank >= 4) entryTrim = ` data-trim="${TRIM.wholeExperience + rank}"`;

  return (
    `<article class="xp"${entryTrim}>` +
    (title ? `<h3 class="xp-role">${esc(title)}</h3>` : '') +
    (meta.length ? `<div class="xp-meta">${meta.join('')}</div>` : '') +
    (bullets ? `<ul class="xp-facts">${bullets}</ul>` : '') +
    `</article>`
  );
}

function educationBlock(profile) {
  const items = (profile.education || []).filter((edu) => edu?.degree || edu?.school);
  if (!items.length) return '';

  return items
    .map((edu) => {
      const meta = [
        edu.school && `${icon('building')}<span class="org">${esc(edu.school)}</span>`,
        edu.location && `${icon('pin')}<span>${esc(edu.location)}</span>`,
        edu.period && `${icon('calendar')}<span>${esc(edu.period)}</span>`,
      ].filter(Boolean);

      return (
        `<article class="xp">` +
        (edu.degree ? `<h3 class="xp-role">${esc(edu.degree)}</h3>` : '') +
        (meta.length ? `<div class="xp-meta">${meta.join('')}</div>` : '') +
        (edu.detail ? `<p class="xp-note" data-trim="${TRIM.eduDetail}">${esc(edu.detail)}</p>` : '') +
        `</article>`
      );
    })
    .join('');
}

// --- Ajustement à une page (embarqué dans le document) ------------------

/**
 * Réduit la densité jusqu'à ce que le contenu tienne sur la page, puis, si ça
 * ne suffit pas, retire les puces les moins utiles (les plus profondes des
 * postes les plus anciens). Publie le résultat dans `window.__cvFit`.
 */
const FIT_SCRIPT = `
(function () {
  var MIN = 0.74;
  var page = document.querySelector('.page');
  var sheet = document.querySelector('.sheet');
  if (!page || !sheet) return;

  var limit = page.clientHeight;
  var height = function () { return sheet.getBoundingClientRect().height; };
  var apply = function (k) { page.style.setProperty('--k', String(k)); };

  // Densité maximale qui tient : recherche dichotomique, 16 tours suffisent.
  function fitDensity(max) {
    apply(max);
    if (height() <= limit) return max;
    var low = MIN, high = max;
    for (var i = 0; i < 16; i++) {
      var mid = (low + high) / 2;
      apply(mid);
      if (height() <= limit) low = mid; else high = mid;
    }
    apply(low);
    return low;
  }

  var start = parseFloat(page.dataset.density || '1') || 1;
  var k = fitDensity(start);
  var trimmed = 0;

  // Toujours trop long : on sacrifie les puces, de la moins utile à la plus utile.
  if (height() > limit && page.dataset.autotrim === '1') {
    var spare = Array.prototype.slice.call(page.querySelectorAll('[data-trim]'));
    spare.sort(function (a, b) { return +b.dataset.trim - +a.dataset.trim; });
    for (var j = 0; j < spare.length && height() > limit; j++) {
      spare[j].style.display = 'none';
      spare[j].setAttribute('data-trimmed', '1');
      trimmed++;
      k = fitDensity(start);
    }
  }

  window.__cvFit = {
    density: Math.round(k * 1000) / 1000,
    trimmed: trimmed,
    overflow: height() > limit + 1,
    fill: Math.min(1, Math.round((height() / limit) * 1000) / 1000)
  };
  document.documentElement.setAttribute('data-cv-ready', '1');
  window.dispatchEvent(new CustomEvent('cv:fit', { detail: window.__cvFit }));
})();
`;

// --- Feuille de style ---------------------------------------------------

/**
 * Tout ce qui est écrit dans la page s'exprime en `em`, donc relativement à
 * `--k`. Changer cette seule variable comprime ou aère le CV en entier :
 * c'est ce qui rend l'ajustement à une page possible sans casser la mise en page.
 */
const styles = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
@page{size:A4;margin:0}

.page{
  --k:1;
  --accent:#2d5bff;
  --side-w:64mm;
  --ink:#15161c;
  --soft:#5c6172;
  --line:#dcdfe6;
  --side-bg:#f6f7fa;
  position:relative;
  width:210mm;height:297mm;overflow:hidden;
  font-family:Inter,'Helvetica Neue',Helvetica,Arial,'Liberation Sans',sans-serif;
  font-size:calc(10.3pt * var(--k));
  line-height:1.42;color:var(--ink);
  background:linear-gradient(to right,var(--side-bg) 0,var(--side-bg) var(--side-w),#fff var(--side-w),#fff 100%);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.sheet{display:flex;align-items:stretch}
.col-side{width:var(--side-w);flex:0 0 var(--side-w);padding:1.5em 1.1em 1.5em 1.4em}
.col-main{flex:1 1 auto;min-width:0;padding:1.5em 1.4em 1.5em 1.2em}

.blk{margin-top:1.25em}
.blk:first-child{margin-top:0}

/* Identité */
.photo{display:block;width:23mm;height:23mm;border-radius:50%;object-fit:cover;
  margin:0 auto .75em;border:2px solid #fff;box-shadow:0 0 0 1.5px var(--accent)}
.cv-name{font-size:1.55em;line-height:1.12;font-weight:800;letter-spacing:-.02em;margin:0}
.cv-role{margin:.3em 0 0;font-size:.78em;font-weight:700;letter-spacing:.07em;
  text-transform:uppercase;color:var(--accent)}

/* Titres de rubrique */
.side-h{font-size:.66em;font-weight:800;letter-spacing:.11em;text-transform:uppercase;
  color:var(--soft);margin:0 0 .6em;padding-bottom:.35em;border-bottom:1px solid var(--line)}
.main-h{font-size:.86em;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink);margin:0 0 .7em;padding-bottom:.3em;border-bottom:1.5px solid var(--ink)}

/* Listes de la colonne latérale */
.ic{width:1em;height:1em;flex:0 0 1em;margin-top:.2em;color:var(--accent)}
.contact,.links,.langs,.certs{list-style:none;margin:0;padding:0}
.contact li,.links li,.langs li,.certs li{display:flex;gap:.45em;align-items:flex-start;
  margin-bottom:.4em;font-size:.82em;line-height:1.35;word-break:break-word}
.contact a,.links a{color:inherit;text-decoration:none}
.certs li strong{display:block;font-weight:700}
.certs li em{display:block;font-style:normal;color:var(--soft);font-size:.92em}
.langs li strong{font-weight:700}

/* Compétences */
.fam{font-size:.66em;font-weight:800;letter-spacing:.07em;text-transform:uppercase;
  color:var(--soft);margin:.7em 0 .35em}
.fam:first-child{margin-top:0}
.chips{display:flex;flex-wrap:wrap;gap:.28em}
.chip{font-size:.7em;line-height:1.5;padding:.12em .55em;border-radius:.5em;
  color:var(--accent);background:#fff;border:1px solid var(--line);white-space:nowrap}

/* Résumé.
   Pas de césure automatique (hyphens) : elle insère un U+2010 dans la couche
   texte du PDF, et « microservice » en ressort coupé en « mi-croservice ».
   Un ATS qui cherche le mot-clé ne le trouve plus. La justification, elle,
   ne coupe aucun mot. */
.summary{margin:0;font-size:.92em;line-height:1.5;text-align:justify}

/* Parcours */
.xp{margin-bottom:.85em;break-inside:avoid}
.xp:last-child{margin-bottom:0}
.xp-role{margin:0;font-size:.98em;font-weight:700;line-height:1.25}
.xp-meta{display:flex;flex-wrap:wrap;gap:.15em .9em;align-items:center;
  margin:.18em 0 .3em;font-size:.75em;color:var(--soft)}
.xp-meta .ic{margin-top:0;width:.95em;height:.95em;flex-basis:.95em}
.xp-meta>*{display:inline-flex;align-items:center;gap:.3em}
.xp-meta .org{font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--ink)}
.xp-facts{list-style:none;margin:0;padding:0}
.xp-facts li{position:relative;padding-left:.85em;margin-bottom:.16em;
  font-size:.85em;line-height:1.42}
.xp-facts li::before{content:'';position:absolute;left:0;top:.52em;
  width:.28em;height:.28em;border-radius:50%;background:var(--accent)}
.xp-note{margin:.15em 0 0;font-size:.82em;color:var(--soft)}
`;

// --- Document -----------------------------------------------------------

export const A4 = { widthMm: 210, heightMm: 297 };

/**
 * Construit le document HTML du CV.
 *
 * @param {object} profile  Le profil (modèle `Profile` du serveur).
 * @param {object} [options]
 * @param {string} [options.accent]     Couleur d'accent (hex).
 * @param {number} [options.density]    Densité de départ ; l'ajustement part de là.
 * @param {boolean} [options.showPhoto] Afficher la photo si le profil en a une.
 * @param {boolean} [options.autoTrim]  Autoriser le retrait de puces si le CV déborde.
 * @param {string[]} [options.hidden]   Rubriques à ne pas rendre.
 * @returns {string} Un document HTML complet et autonome.
 */
export function buildCvDocument(profile = {}, options = {}) {
  const opts = { ...(profile.cvOptions || {}), ...options };
  const accent = /^#[0-9a-f]{3,8}$/i.test(opts.accent || '') ? opts.accent : '#2d5bff';
  const density = Math.min(1.15, Math.max(0.74, Number(opts.density) || 1));
  const hidden = new Set(opts.hidden || []);
  const autoTrim = opts.autoTrim !== false;

  const photo = opts.showPhoto === false ? '' : safePhoto(profile.photo);
  const experiences = (profile.experiences || []).filter((exp) => exp?.role || exp?.company);
  const projects = (profile.projects || []).filter((item) => item?.name || item?.role);

  const side = [
    photo ? `<img class="photo" src="${esc(photo)}" alt="">` : '',
    profile.fullName ? `<h1 class="cv-name">${esc(profile.fullName)}</h1>` : '',
    profile.headline ? `<p class="cv-role">${esc(profile.headline)}</p>` : '',
    contactBlock(profile),
    hidden.has('skills') ? '' : sideSection('Compétences', skillsBlock(profile)),
    hidden.has('links') ? '' : sideSection('Liens', linksBlock(profile)),
    hidden.has('languages') ? '' : sideSection('Langues', languagesBlock(profile)),
    hidden.has('certifications') ? '' : sideSection('Certifications', certificationsBlock(profile)),
  ]
    .filter(Boolean)
    .join('');

  const main = [
    profile.summary && !hidden.has('summary')
      ? `<section class="blk"><p class="summary">${esc(profile.summary)}</p></section>`
      : '',
    hidden.has('experiences')
      ? ''
      : mainSection(
          'Expériences professionnelles',
          experiences.map((exp, index) => entryBlock(exp, index)).join('')
        ),
    hidden.has('projects')
      ? ''
      : mainSection(
          'Projets',
          projects
            .map((item, index) =>
              entryBlock(item, index, { titleKey: 'name', kind: 'project' })
            )
            .join('')
        ),
    hidden.has('education') ? '' : mainSection('Formation', educationBlock(profile)),
  ]
    .filter(Boolean)
    .join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${esc(profile.fullName || 'CV')}</title>
<style>${styles}</style>
</head>
<body>
<div class="page" style="--accent:${esc(accent)}" data-density="${density}" data-autotrim="${
    autoTrim ? '1' : '0'
  }">
  <div class="sheet">
    <aside class="col-side">${side}</aside>
    <main class="col-main">${main}</main>
  </div>
</div>
<script>${FIT_SCRIPT}</script>
</body>
</html>`;
}
