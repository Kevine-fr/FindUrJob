import JobOffer from '../models/JobOffer.js';
import SearchPreference from '../models/SearchPreference.js';
import { asyncHandler } from '../middleware.js';
import { searchOffers } from '../services/tailoringService.js';
import { botSearch, botConfigured } from '../services/botService.js';
import { SOURCES, CONTRACT_TYPES, REMOTE, BOT_SEARCH_SOURCES } from '../utils/constants.js';

// Les filtres arrivent en valeurs multiples séparées par des virgules :
//   ?contractType=cdi,alternance&remote=teletravail,hybride
const asList = (value) =>
  value
    ? String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

// Une recherche libre peut contenir des caractères de regex ( ) [ + ...
// Sans échappement, « C++ » ou « (H/F) » fait tomber la requête en 500.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;

/**
 * GET /offers — liste paginée.
 *
 * La réponse est un objet `{ offers, total, page, pages }` : sans le total, le
 * front ne peut pas distinguer « 60 offres en base » de « 60 offres affichées
 * sur 400 », qui est exactement la confusion à éviter ici.
 */
export const listOffers = asyncHandler(async (req, res) => {
  const { q, location } = req.query;
  // Cloisonnement : chaque lecture part du propriétaire.
  const filter = { user: req.user.id };

  const sources = asList(req.query.source);
  const contractTypes = asList(req.query.contractType);
  const remotes = asList(req.query.remote);

  if (sources.length) filter.source = { $in: sources };
  if (contractTypes.length) filter.contractType = { $in: contractTypes };
  if (remotes.length) filter.remote = { $in: remotes };
  if (location) filter.location = new RegExp(escapeRegex(location), 'i');

  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { title: pattern },
      { company: pattern },
      { description: pattern },
      { keywords: pattern },
    ];
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const [offers, total] = await Promise.all([
    JobOffer.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    JobOffer.countDocuments(filter),
  ]);

  res.json({ offers, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
});

export const getOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findOne({ _id: req.params.id, user: req.user.id });
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.json(offer);
});

export const createOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.create({ ...req.body, user: req.user.id });
  res.status(201).json(offer);
});

export const updateOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    req.body,
    { new: true, runValidators: true }
  );
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.json(offer);
});

export const deleteOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.status(204).end();
});

// Ne garde d'une source que ce que le modèle sait stocker.
const sanitize = (offer) => ({
  title: String(offer.title || '').trim(),
  company: String(offer.company || '').trim(),
  location: String(offer.location || '').trim(),
  source: SOURCES.includes(offer.source) ? offer.source : 'autre',
  sourceUrl: String(offer.sourceUrl || '').trim(),
  externalId: String(offer.externalId || '').trim() || undefined,
  description: String(offer.description || ''),
  contractType: CONTRACT_TYPES.includes(offer.contractType) ? offer.contractType : 'autre',
  remote: REMOTE.includes(offer.remote) ? offer.remote : 'non_precise',
  salary: String(offer.salary || '').trim(),
  keywords: Array.isArray(offer.keywords) ? offer.keywords.map(String).slice(0, 20) : [],
});

/**
 * Interroge les deux moteurs en parallèle.
 *
 * - le moteur Python pour les sources à API (France Travail, Adzuna, Remotive) ;
 * - le bot pour celles qui n'en ont pas (LinkedIn, Indeed, HelloWork).
 *
 * `limit` s'entend **par source** : demander 50 sur cinq sources branchées peut
 * donc rapporter 250 offres. C'est l'intérêt d'agréger.
 */
async function gather(criteria, wantedSources, user) {
  const apiSources = wantedSources.filter((source) => !BOT_SEARCH_SOURCES.includes(source));
  const botPlatforms = wantedSources.filter((source) => BOT_SEARCH_SOURCES.includes(source));

  const tasks = [];

  // Aucune source d'API explicitement demandée = on les prend toutes.
  if (!wantedSources.length || apiSources.length) {
    tasks.push(
      searchOffers({ ...criteria, sources: apiSources }).then(
        (result) => ({ offers: result.offers || [], report: result.sources || {} }),
        (error) => ({ offers: [], report: { 'moteur IA': `échec (${error.message})` } })
      )
    );
  }

  if (botConfigured()) {
    const platforms = botPlatforms.length
      ? botPlatforms
      : !wantedSources.length
        ? BOT_SEARCH_SOURCES
        : [];
    for (const platform of platforms) {
      tasks.push(
        botSearch(platform, criteria, user).then(
          (result) => ({
            offers: result.offers || [],
            report: { [platform]: `${result.total || 0} offre(s)` },
          }),
          // Une plateforme bloquée ne doit pas faire échouer la recherche entière,
          // mais son échec doit rester visible.
          (error) => ({ offers: [], report: { [platform]: `échec (${error.message})` } })
        )
      );
    }
  }

  const results = await Promise.all(tasks);
  return {
    offers: results.flatMap((result) => result.offers),
    report: Object.assign({}, ...results.map((result) => result.report)),
  };
}

/**
 * POST /offers/sync — va chercher des offres et les enregistre.
 *
 * Sans corps, la recherche reprend les préférences enregistrées. Les offres
 * déjà connues (même source + même externalId) sont mises à jour, pas dupliquées.
 */
export const syncOffers = asyncHandler(async (req, res) => {
  const prefs = await SearchPreference.forUser(req.user.id);
  const body = req.body || {};

  const criteria = {
    keywords: body.keywords ?? prefs.keywords ?? [],
    location: body.location ?? (prefs.locations || [])[0] ?? '',
    contractTypes: body.contractTypes ?? prefs.contractTypes ?? [],
    remotes: body.remotes ?? prefs.remotes ?? [],
    limit: Math.min(Math.max(Number(body.limit) || 50, 1), MAX_PAGE_SIZE),
  };

  const wantedSources = (body.sources ?? []).filter((source) => SOURCES.includes(source));
  const { offers: found, report } = await gather(criteria, wantedSources, req.user.id);

  const excluded = (prefs.excludedKeywords || []).map((word) => word.toLowerCase()).filter(Boolean);

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of found) {
    const offer = sanitize(raw);
    if (!offer.title) {
      skipped += 1;
      continue;
    }

    // Filtre d'exclusion : appliqué ici, pour ne pas polluer la base.
    const haystack = `${offer.title} ${offer.company} ${offer.description}`.toLowerCase();
    if (excluded.some((word) => haystack.includes(word))) {
      skipped += 1;
      continue;
    }

    const identity = offer.externalId
      ? { source: offer.source, externalId: offer.externalId }
      : { source: offer.source, title: offer.title, company: offer.company };

    const existing = await JobOffer.findOne({ ...identity, user: req.user.id });
    if (existing) {
      existing.set(offer);
      await existing.save();
      updated += 1;
    } else {
      await JobOffer.create({ ...offer, user: req.user.id });
      imported += 1;
    }
  }

  res.json({
    imported,
    updated,
    skipped,
    found: found.length,
    sources: report,
    criteria: { ...criteria, sources: wantedSources },
  });
});
