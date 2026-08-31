/**
 * Marque : la pastille et le mot-symbole.
 *
 * Le dessin reprend le logo — casque de chantier posé sur la lentille d'une
 * loupe — mais ses couleurs passent par les jetons plutôt que par des valeurs
 * figées : la plaque s'éclaircit en thème sombre, où un navy plein se
 * confondrait avec le fond de la barre latérale. Le fichier `favicon.svg`, lui,
 * garde des couleurs fixes : il est lu hors de la page, sans feuille de style.
 */

export function BrandMark({ size = 28, className }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="findJOBS"
      focusable="false"
    >
      <rect width="512" height="512" rx="116" fill="hsl(var(--brand-hsl))" />
      {/* Le haut de l'anneau disparaît sous le casque : le cercle est tracé
          entier, ce qui évite une jointure d'arc visible à petite taille. */}
      <circle cx="256" cy="252" r="94" fill="none" stroke="hsl(var(--brand-accent-hsl))" strokeWidth="40" />
      <path d="M256 352v76" fill="none" stroke="hsl(var(--brand-accent-hsl))" strokeWidth="44" strokeLinecap="round" />
      <path d="M176 232a80 80 0 0 1 160 0z" fill="hsl(var(--brand-accent-hsl))" />
      <rect x="140" y="222" width="232" height="36" rx="18" fill="hsl(var(--brand-accent-hsl))" />
      <circle cx="256" cy="192" r="26" fill="hsl(var(--brand-hsl))" />
    </svg>
  );
}

/** Pastille + mot-symbole, pour la barre latérale et l'en-tête mobile. */
export function Brand({ size = 28 }) {
  return (
    <div className="brand">
      <BrandMark size={size} />
      <span className="brand-text" aria-hidden="true">
        find<strong>JOBS</strong>
      </span>
    </div>
  );
}
