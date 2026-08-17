import cron from 'node-cron';
import Campaign from '../models/Campaign.js';
import { asyncHandler } from '../middleware.js';
import { runCampaign } from '../services/campaignRunner.js';
import { reschedule, describeSchedule } from '../scheduler.js';
import { BOT_PLATFORMS, SOURCES, CONTRACT_TYPES, REMOTE } from '../utils/constants.js';

/**
 * Vue publique enrichie de ce que le front ne peut pas deviner : quelles
 * sources existent, et lesquelles savent réellement envoyer une candidature.
 */
const publicView = (campaign) => ({
  ...campaign.toObject(),
  // `null` = sans limite. JSON ne sait pas transporter l'infini, et le rendre
  // explicite évite que l'interface l'affiche comme un zéro.
  remainingToday: Number.isFinite(campaign.remainingToday().left)
    ? campaign.remainingToday().left
    : null,
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
  const {
    enabled, cron: expression, timezone, mode, cvMode, dailyLimit, minScore, targets,
    maxAgeValue, maxAgeUnit, maxApplicants, contractTypes, remotes,
  } = req.body || {};

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
  if (cvMode) campaign.cvMode = cvMode;
  // Listes vides autorisées : « aucun filtre » est un choix, pas un oubli.
  if (Array.isArray(contractTypes)) {
    campaign.contractTypes = contractTypes.filter((t) => CONTRACT_TYPES.includes(t));
  }
  if (Array.isArray(remotes)) campaign.remotes = remotes.filter((r) => REMOTE.includes(r));

  // Les nombres arrivent parfois vides d'un champ de saisie effacé : on retombe
  // sur la valeur en place plutôt que d'écrire NaN en base.
  const asNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  // Vide ou nul = « sans limite ». Aucun plafond n'est imposé au-dessus : le
  // volume est une décision de l'utilisateur, pas de l'application.
  if (dailyLimit !== undefined) {
    campaign.dailyLimit =
      dailyLimit === '' || dailyLimit === null
        ? null
        : Math.max(1, asNumber(dailyLimit, campaign.dailyLimit ?? 10));
  }
  if (minScore !== undefined) campaign.minScore = asNumber(minScore, campaign.minScore);
  if (maxAgeValue !== undefined) campaign.maxAgeValue = Math.max(0, asNumber(maxAgeValue, 0));
  if (maxAgeUnit) campaign.maxAgeUnit = maxAgeUnit;
  // Chaîne vide = « pas de limite » : on distingue explicitement de zéro.
  if (maxApplicants !== undefined) {
    campaign.maxApplicants =
      maxApplicants === "" || maxApplicants === null ? null : Math.max(0, asNumber(maxApplicants, 0));
  }

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
 * POST /campaign/run — exécution immédiate. `?dryRun=1` remplit les formulaires
 * jusqu'au bouton d'envoi sans jamais appuyer dessus.
 *
 * Le même code que la version planifiée : c'est le seul moyen honnête de
 * vérifier ce que fera la campagne cette nuit. Le mode essai existe parce qu'un
 * envoi ne se rattrape pas — un employeur ne « dé-reçoit » pas une candidature.
 */
export const runNow = asyncHandler(async (req, res) => {
  const summary = await runCampaign({
    user: req.user.id,
    trigger: 'manuel',
    dryRun: req.query.dryRun === '1' || req.body?.dryRun === true,
  });
  res.json({ summary, campaign: publicView(await Campaign.forUser(req.user.id)) });
});
