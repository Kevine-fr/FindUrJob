import JobOffer from '../models/JobOffer.js';
import SearchPreference from '../models/SearchPreference.js';
import { asyncHandler } from '../middleware.js';
import { searchOffers } from '../services/tailoringService.js';
import { SOURCES, CONTRACT_TYPES, REMOTE } from '../utils/constants.js';

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

export const listOffers = asyncHandler(async (req, res) => {
  const { q, location } = req.query;
  const filter = {};

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

  const offers = await JobOffer.find(filter).sort({ createdAt: -1 });
  res.json(offers);
});

export const getOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findById(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.json(offer);
});

export const createOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.create(req.body);
  res.status(201).json(offer);
});

export const updateOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.json(offer);
});

export const deleteOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findByIdAndDelete(req.params.id);
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
 * POST /offers/sync — va chercher des offres et les enregistre.
 *
 * Sans corps, la recherche reprend les préférences enregistrées. Les offres
 * déjà connues (même source + même externalId) sont mises à jour, pas dupliquées.
 */
export const syncOffers = asyncHandler(async (req, res) => {
  const prefs = await SearchPreference.getSingleton();
  const body = req.body || {};

  const criteria = {
    keywords: body.keywords ?? prefs.keywords ?? [],
    location: body.location ?? (prefs.locations || [])[0] ?? '',
    contractTypes: body.contractTypes ?? prefs.contractTypes ?? [],
    remotes: body.remotes ?? prefs.remotes ?? [],
    sources: body.sources ?? [],
    limit: Math.min(Number(body.limit) || 25, 50),
  };

  const result = await searchOffers(criteria);
  const excluded = (prefs.excludedKeywords || []).map((word) => word.toLowerCase()).filter(Boolean);

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of result.offers || []) {
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

    const existing = await JobOffer.findOne(identity);
    if (existing) {
      existing.set(offer);
      await existing.save();
      updated += 1;
    } else {
      await JobOffer.create(offer);
      imported += 1;
    }
  }

  res.json({
    imported,
    updated,
    skipped,
    found: result.total || 0,
    sources: result.sources || {},
    criteria,
  });
});
