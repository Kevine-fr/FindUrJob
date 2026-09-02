import { asyncHandler } from '../middleware.js';
import { construireHistorique } from '../services/historyService.js';
import { ACTIVITY_CATEGORIES } from '../utils/activity.js';

/**
 * Lit une borne de période depuis la requête.
 *
 * Une date invalide est ignorée plutôt que refusée : un filtre mal formé ne
 * doit pas transformer la page en erreur, il doit juste ne pas filtrer.
 */
export function lireDate(valeur) {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** Familles demandées, réduites à celles qui existent. */
export function lireCategories(valeur) {
  if (!valeur) return null;
  const demandees = String(valeur)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ACTIVITY_CATEGORIES.includes(item));
  return demandees.length ? demandees : null;
}

/**
 * GET /history — tout ce que le compte a produit, du plus récent au plus ancien.
 *
 * Filtres : ?categories=candidature,cv &from=2026-01-01 &to=2026-02-01
 *           &q=texte &limit=200 &skip=0
 */
export const listHistory = asyncHandler(async (req, res) => {
  const { q, limit, skip } = req.query;

  const resultat = await construireHistorique(req.user.id, {
    from: lireDate(req.query.from),
    to: lireDate(req.query.to),
    categories: lireCategories(req.query.categories),
    q: q || '',
    limit,
    skip,
  });

  res.json(resultat);
});
