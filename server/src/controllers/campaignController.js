import cron from 'node-cron';
import Campaign from '../models/Campaign.js';
import { asyncHandler } from '../middleware.js';
import { runCampaign } from '../services/campaignRunner.js';
import { reschedule, describeSchedule } from '../scheduler.js';
import { BOT_PLATFORMS } from '../utils/constants.js';

// Rythmes proposés dans l'interface : le champ `cron` reste libre pour qui
// veut autre chose, mais personne ne devrait avoir à écrire du cron pour
// « tous les matins ».
export const PRESETS = [
  { id: 'quotidien-matin', label: 'Chaque matin (9h)', cron: '0 9 * * *' },
  { id: 'ouvres-matin', label: 'Du lundi au vendredi (9h)', cron: '0 9 * * 1-5' },
  { id: 'ouvres-2x', label: 'Du lundi au vendredi (9h et 17h)', cron: '0 9,17 * * 1-5' },
  { id: 'toutes-4h', label: 'Toutes les 4 heures', cron: '0 */4 * * *' },
  { id: 'hebdo', label: 'Chaque lundi (9h)', cron: '0 9 * * 1' },
];

const publicView = (campaign) => ({
  ...campaign.toObject(),
  remainingToday: campaign.remainingToday().left,
  schedule: describeSchedule(),
  presets: PRESETS,
});

export const getCampaign = asyncHandler(async (_req, res) => {
  res.json(publicView(await Campaign.getSingleton()));
});

/** PUT /campaign — enregistre les réglages et reprogramme dans la foulée. */
export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.getSingleton();
  const { enabled, cron: expression, timezone, mode, perRun, dailyLimit, minScore, platforms } =
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
  if (perRun !== undefined) campaign.perRun = Number(perRun);
  if (dailyLimit !== undefined) campaign.dailyLimit = Number(dailyLimit);
  if (minScore !== undefined) campaign.minScore = Number(minScore);
  if (Array.isArray(platforms)) {
    campaign.platforms = platforms.filter((name) => BOT_PLATFORMS.includes(name));
  }

  await campaign.save();
  await reschedule();

  res.json(publicView(await Campaign.getSingleton()));
});

/**
 * POST /campaign/run — exécution immédiate.
 *
 * Le même code que la version planifiée : c'est le seul moyen honnête de
 * vérifier ce que fera la campagne cette nuit.
 */
export const runNow = asyncHandler(async (_req, res) => {
  const summary = await runCampaign({ trigger: 'manuel' });
  res.json({ summary, campaign: publicView(await Campaign.getSingleton()) });
});
