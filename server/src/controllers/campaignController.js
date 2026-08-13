import cron from 'node-cron';
import Campaign from '../models/Campaign.js';
import { asyncHandler } from '../middleware.js';
import { runCampaign } from '../services/campaignRunner.js';
import { reschedule, describeSchedule } from '../scheduler.js';
import { BOT_PLATFORMS, SOURCES } from '../utils/constants.js';

/**
 * Vue publique enrichie de ce que le front ne peut pas deviner : quelles
 * sources existent, et lesquelles savent réellement envoyer une candidature.
 */
const publicView = (campaign) => ({
  ...campaign.toObject(),
  remainingToday: campaign.remainingToday().left,
  schedule: describeSchedule(),
  sources: SOURCES.filter((source) => source !== 'autre').map((source) => ({
    source,
    // Ailleurs, l'annonce renvoie vers un site tiers : on peut préparer le
    // dossier, pas l'envoyer.
    canSend: BOT_PLATFORMS.includes(source),
  })),
});

export const getCampaign = asyncHandler(async (req, res) => {
  res.json(publicView(await Campaign.forUser(req.user.id)));
});

/** PUT /campaign — enregistre les réglages et reprogramme dans la foulée. */
export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.forUser(req.user.id);
  const { enabled, cron: expression, timezone, mode, dailyLimit, minScore, targets } =
    req.body || {};

  if (expression !== undefined) {
    if (!cron.validate(expression)) {
      return res.status(400).json({
        error:
          `Expression cron invalide : « ${expression} ». ` +
          'Format attendu : minute heure jour mois jour-semaine (ex. 0 9 * * 1-5).',
      });
    }
    campaign.cron = expression;
  }

  if (enabled !== undefined) campaign.enabled = Boolean(enabled);
  if (timezone) campaign.timezone = timezone;
  if (mode) campaign.mode = mode;

  // Les nombres arrivent parfois vides d'un champ de saisie effacé : on retombe
  // sur la valeur en place plutôt que d'écrire NaN en base.
  const asNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  if (dailyLimit !== undefined) campaign.dailyLimit = asNumber(dailyLimit, campaign.dailyLimit);
  if (minScore !== undefined) campaign.minScore = asNumber(minScore, campaign.minScore);

  if (Array.isArray(targets)) {
    campaign.targets = targets
      .filter((target) => SOURCES.includes(target?.source))
      .map((target) => ({
        source: target.source,
        limit: Math.max(0, Math.min(50, asNumber(target.limit, 0))),
      }));
  }

  await campaign.save();
  await reschedule();

  res.json(publicView(await Campaign.forUser(req.user.id)));
});

/**
 * POST /campaign/run — exécution immédiate.
 *
 * Le même code que la version planifiée : c'est le seul moyen honnête de
 * vérifier ce que fera la campagne cette nuit.
 */
export const runNow = asyncHandler(async (req, res) => {
  const summary = await runCampaign({ user: req.user.id, trigger: 'manuel' });
  res.json({ summary, campaign: publicView(await Campaign.forUser(req.user.id)) });
});
