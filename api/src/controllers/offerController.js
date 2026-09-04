import JobOffer from '../models/JobOffer.js';
import { geocode } from '../services/geocoding.js';
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

// Combien d'adresses la carte résout par visite. À une requête par seconde,
// vingt tiennent dans le temps d'une consultation sans saturer Nominatim.
const GEO_BATCH = 20;

// Au-delà, le navigateur peine à poser les marqueurs et la carte n'apprend plus
// rien : les offres sont de toute façon groupées par ville.
const MAP_LIMIT = 2000;

// Unités acceptées pour l'ancienneté, en millisecondes.
const UNITES = {
  minute: 60_000,
  heure: 3_600_000,
  jour: 86_400_000,
  semaine: 604_800_000,
  mois: 2_592_000_000, // 30 jours — suffisant pour un filtre de fraîcheur
};

/**
 * « Publiée il y a moins de N <unité> » → date plancher.
 * Format attendu : `publishedWithin=3&publishedUnit=jour`.
 */
function depuisQuand(value, unit) {
  const n = Number(value);
  const ms = UNITES[unit];
  if (!Number.isFinite(n) || n <= 0 || !ms) return null;
  return new Date(Date.now() - n * ms);
}

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

  // Fraîcheur : on retient aussi les offres sans date connue quand la source
  // ne la donne pas — les écarter reviendrait à masquer des annonces valables
  // pour un champ manquant.
  const plancher = depuisQuand(req.query.publishedWithin, req.query.publishedUnit);
  if (plancher) {
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ publishedAt: { $gte: plancher } }, { publishedAt: null, createdAt: { $gte: plancher } }] },
    ];
  }

  // Concurrence : « moins de N candidats ». Une offre au compteur inconnu n'est
  // pas une offre à zéro candidat — elle sort du filtre plutôt que de le fausser.
  const maxCandidats = Number(req.query.maxApplicants);
  if (Number.isFinite(maxCandidats) && maxCandidats >= 0) {
    filter.applicantCount = { $ne: null, $lte: maxCandidats };
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(Number(req.query.page) || 1, 1);

  // Trier par fraîcheur quand on filtre dessus : la date de collecte n'a plus
  // d'intérêt dès qu'on raisonne en date de publication.
  const tri = plancher || req.query.sort === 'published' ? { publishedAt: -1, createdAt: -1 } : { createdAt: -1 };

  const [offers, total] = await Promise.all([
    JobOffer.find(filter)
      .sort(tri)
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
  // Date de la plateforme, distincte de la date de collecte.
  publishedAt: offer.publishedAt ? new Date(offer.publishedAt) : undefined,
  // `null` signifie « inconnu » : on ne le confond pas avec zéro candidat.
  applicantCount: Number.isFinite(Number(offer.applicantCount))
    ? Number(offer.applicantCount)
    : null,
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
/**
 * Collecte les offres pour un compte et les enregistre.
 *
 * Extrait du gestionnaire HTTP pour que le planificateur puisse l’appeler :
 * la campagne ne postule qu’aux offres **déjà en base**, donc sans collecte
 * régulière elle finit par tourner à vide sur un vivier périmé.
 */
export async function collectOffers(userId, body = {}) {
  const prefs = await SearchPreference.forUser(userId);

  const criteria = {
    keywords: body.keywords ?? prefs.keywords ?? [],
    location: body.location ?? (prefs.locations || [])[0] ?? '',
    contractTypes: body.contractTypes ?? prefs.contractTypes ?? [],
    remotes: body.remotes ?? prefs.remotes ?? [],
    limit: Math.min(Math.max(Number(body.limit) || 50, 1), MAX_PAGE_SIZE),
  };

  const wantedSources = (body.sources ?? []).filter((source) => SOURCES.includes(source));
  const { offers: found, report } = await gather(criteria, wantedSources, userId);

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

    /*
     * L'adresse de l'annonce identifie le poste, mieux que l'identifiant.
     *
     * Welcome to the Jungle publie une même annonce sous plusieurs
     * enregistrements — un par bureau — chacun avec son propre `externalId`.
     * Dédoublonner dessus créait donc trois offres pour un seul poste, puis
     * trois candidatures : la liste affichait Galadrim trois fois, toutes
     * « Postulé ». Mesuré sur une collecte réelle : dix-sept titres en double
     * sur soixante, tous identiques jusqu'à l'URL près.
     *
     * On passe donc par `sourceUrl` en premier. L'`externalId` reste utile pour
     * les sources qui n'exposent pas d'adresse stable, et le titre + société
     * ferment la marche pour les saisies à la main.
     */
    const identity = offer.sourceUrl
      ? { source: offer.source, sourceUrl: offer.sourceUrl }
      : offer.externalId
        ? { source: offer.source, externalId: offer.externalId }
        : { source: offer.source, title: offer.title, company: offer.company };

    const existing = await JobOffer.findOne({ ...identity, user: userId });
    if (existing) {
      existing.set(offer);
      await existing.save();
      updated += 1;
    } else {
      await JobOffer.create({ ...offer, user: userId });
      imported += 1;
    }
  }

  return {
    imported,
    updated,
    skipped,
    found: found.length,
    sources: report,
    criteria: { ...criteria, sources: wantedSources },
  };
}

/** POST /offers/sync — la même collecte, déclenchée à la main. */
export const syncOffers = asyncHandler(async (req, res) => {
  res.json(await collectOffers(req.user.id, req.body || {}));
});

/**
 * GET /offers/map — les offres situables, pour la carte.
 *
 * Le géocodage est fait par petits lots plutôt qu'en une passe : Nominatim
 * impose une requête par seconde, donc résoudre 600 offres prendrait dix
 * minutes et la page attendrait dans le vide. On rend immédiatement ce qui est
 * déjà situé, on résout quelques adresses de plus en arrière-plan, et la carte
 * se remplit au fil des visites.
 *
 * `pending` dit combien restent à résoudre : sans ce chiffre, une carte à moitié
 * pleine ressemble à une carte cassée.
 */
export const mapOffers = asyncHandler(async (req, res) => {
  const filter = { user: req.user.id };

  // Les mêmes filtres que la liste, dans la même syntaxe : une carte qui
  // contredit la page Offres ne sert à rien.
  const sources = asList(req.query.source);
  const contractTypes = asList(req.query.contractType);
  const remotes = asList(req.query.remote);

  if (sources.length) filter.source = { $in: sources };
  if (contractTypes.length) filter.contractType = { $in: contractTypes };
  if (remotes.length) filter.remote = { $in: remotes };

  if (req.query.q) {
    const pattern = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ title: pattern }, { company: pattern }, { keywords: pattern }];
  }

  const situees = await JobOffer.find({ ...filter, lat: { $ne: null } })
    .select('title company location source contractType remote lat lon publishedAt applicantCount sourceUrl')
    .sort({ publishedAt: -1 })
    .limit(MAP_LIMIT);

  // À résoudre : jamais tentées, et pourvues d'une adresse.
  const aResoudre = await JobOffer.find({
    ...filter,
    geoAt: null,
    location: { $nin: [null, ''] },
  })
    .select('location')
    .limit(GEO_BATCH);

  /*
   * Le lot part en arrière-plan, sans que la réponse l'attende.
   *
   * Une requête HTTP ne doit pas durer trente secondes parce qu'elle géocode :
   * l'utilisateur verrait une page figée. Les résultats arrivent à la visite
   * suivante, ce qui est acceptable pour une carte qu'on consulte, pas pour un
   * écran qu'on attend.
   */
  if (aResoudre.length) {
    (async () => {
      for (const offre of aResoudre) {
        const point = await geocode(offre.location);
        await JobOffer.updateOne(
          { _id: offre._id },
          point
            ? { lat: point.lat, lon: point.lon, geoAt: new Date() }
            : { geoAt: new Date() } // tentative notée : on ne la refera pas
        );
      }
    })().catch((error) => console.error('géocodage en lot :', error.message));
  }

  const restantes = await JobOffer.countDocuments({
    ...filter,
    geoAt: null,
    location: { $nin: [null, ''] },
  });

  res.json({
    offers: situees,
    placed: situees.length,
    pending: Math.max(0, restantes - aResoudre.length),
    resolving: aResoudre.length,
  });
});
