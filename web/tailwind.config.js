/**
 * Tailwind, en cohabitation avec le système visuel maison.
 *
 * `preflight` est coupé : la remise à zéro de Tailwind écraserait le socle de
 * `tokens.css` (marges, typographie, `box-sizing`) et redessinerait d'un coup
 * les trente-quatre écrans déjà en place. Les utilitaires, eux, restent
 * disponibles pour les composants shadcn ajoutés par-dessus.
 *
 * Les couleurs pointent vers les triplets HSL déclarés dans `tokens.css`. Ce
 * sont les mêmes que ceux dont dérivent les jetons hérités (`--ink`, `--card`,
 * `--accent`…) : un seul changement de thème repeint donc l'ancien CSS et les
 * nouveaux composants ensemble.
 */
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border-hsl) / <alpha-value>)',
        input: 'hsl(var(--input-hsl) / <alpha-value>)',
        ring: 'hsl(var(--ring-hsl) / <alpha-value>)',
        background: 'hsl(var(--background-hsl) / <alpha-value>)',
        foreground: 'hsl(var(--foreground-hsl) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground-hsl) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground-hsl) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground-hsl) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground-hsl) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent-surface-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--accent-surface-foreground-hsl) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground-hsl) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground-hsl) / <alpha-value>)',
        },
        /* Couleurs de marque, hors contrat shadcn : le navy et le jaune du logo. */
        brand: {
          DEFAULT: 'hsl(var(--brand-hsl) / <alpha-value>)',
          foreground: 'hsl(var(--brand-foreground-hsl) / <alpha-value>)',
          accent: 'hsl(var(--brand-accent-hsl) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 3px)',
        sm: 'calc(var(--radius) - 5px)',
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};
