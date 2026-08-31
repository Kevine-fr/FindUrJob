import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Assemble des classes conditionnelles, puis départage les utilitaires
 * Tailwind qui se contredisent : `cn('px-2', 'px-4')` rend `px-4`.
 *
 * Sans `twMerge`, les deux classes partiraient dans le HTML et c'est l'ordre
 * de la feuille de style — pas celui de l'appel — qui trancherait, rendant
 * toute surcharge par `className` imprévisible.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
