import Application from '../models/Application.js';
import CVVersion from '../models/CVVersion.js';
import { asyncHandler } from '../middleware.js';
import { APPLICATION_STATUSES } from '../utils/constants.js';

/**
 * GET /history — tout ce qui s'est passé, du plus récent au plus ancien.
 *
 * Deux sources : les changements de statut déjà journalisés dans
 * `Application.timeline`, et les CV générés. On les fusionne en un flux unique.
 *
 * Filtres : ?status=postule &offer=<id> &from=2026-01-01 &to=2026-02-01 &type=statut|cv
 */
export const listHistory = asyncHandler(async (req, res) => {
  const { status, offer, from, to, type, limit } = req.query;

  const applications = await Application.find(offer ? { offer } : {})
    .populate('offer')
    .sort({ updatedAt: -1 });

  const events = [];

  for (const application of applications) {
    for (const entry of application.timeline || []) {
      events.push({
        type: 'statut',
        at: entry.at,
        status: entry.status,
        note: entry.note || '',
        applicationId: application._id,
        offer: application.offer
          ? {
              _id: application.offer._id,
              title: application.offer.title,
              company: application.offer.company,
              source: application.offer.source,
            }
          : null,
      });
    }
  }

  const cvFilter = offer ? { offer, kind: 'cible' } : { kind: 'cible' };
  const cvVersions = await CVVersion.find(cvFilter).populate('offer').sort({ createdAt: -1 });

  for (const version of cvVersions) {
    events.push({
      type: 'cv',
      at: version.createdAt,
      label: version.label,
      score: typeof version.score === 'number' ? version.score : null,
      cvVersionId: version._id,
      offer: version.offer
        ? {
            _id: version.offer._id,
            title: version.offer.title,
            company: version.offer.company,
            source: version.offer.source,
          }
        : null,
    });
  }

  let filtered = events;
  if (type) filtered = filtered.filter((event) => event.type === type);
  if (status && APPLICATION_STATUSES.includes(status)) {
    filtered = filtered.filter((event) => event.status === status);
  }
  if (from) {
    const since = new Date(from);
    if (!Number.isNaN(since.valueOf())) filtered = filtered.filter((e) => new Date(e.at) >= since);
  }
  if (to) {
    const until = new Date(to);
    if (!Number.isNaN(until.valueOf())) filtered = filtered.filter((e) => new Date(e.at) <= until);
  }

  filtered.sort((a, b) => new Date(b.at) - new Date(a.at));

  const max = Math.min(Number(limit) || 300, 1000);
  res.json({
    total: filtered.length,
    events: filtered.slice(0, max),
  });
});
