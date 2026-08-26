import cron from 'node-cron';
import Alert from '../models/Alert.js';
import PushSubscription from '../models/PushSubscription.js';
import { asyncHandler } from '../middleware.js';
import { runAlert, correspondances, canaux } from '../services/alertRunner.js';
import { publicKey, pushConfigured, notifier } from '../services/webPush.js';
import { rescheduleAlerts } from '../scheduler.js';
import { SOURCES, APPLICATION_STATUSES } from '../utils/constants.js';

/**
 * Alertes : création, réglage, essai.
 *
 * Une alerte appartient à un compte, comme tout le reste : chaque lecture et
 * chaque écriture part du propriétaire, jamais du seul identifiant fourni.
 */

const UNITES = ['minute', 'heure', 'jour', 'semaine', 'mois'];

/** Ne garde du corps reçu que ce que le modèle sait stocker. */
function assainir(body = {}) {
  const propre = {};

  if (typeof body.name === 'string') propre.name = body.name.trim().slice(0, 80) || 'Alerte';
  if (typeof body.enabled === 'boolean') propre.enabled = body.enabled;
  if (typeof body.q === 'string') propre.q = body.q.trim().slice(0, 200);

  if (Array.isArray(body.statuses)) {
    propre.statuses = body.statuses.filter((s) => APPLICATION_STATUSES.includes(s));
  }
  if (Array.isArray(body.sources)) {
    propre.sources = body.sources.filter((s) => SOURCES.includes(s));
  }

  if (body.maxAgeValue !== undefined) {
    const n = Number(body.maxAgeValue);
    propre.maxAgeValue = Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (UNITES.includes(body.maxAgeUnit)) propre.maxAgeUnit = body.maxAgeUnit;

  if (body.maxApplicants !== undefined) {
    // `null` est une valeur légitime : « peu importe le nombre de candidats ».
    const n = Number(body.maxApplicants);
    propre.maxApplicants =
      body.maxApplicants === null || body.maxApplicants === '' || !Number.isFinite(n) ? null : n;
  }

  if (typeof body.email === 'boolean') propre.email = body.email;
  if (typeof body.push === 'boolean') propre.push = body.push;

  if (typeof body.cron === 'string' && cron.validate(body.cron)) propre.cron = body.cron;
  if (typeof body.timezone === 'string') propre.timezone = body.timezone.slice(0, 60);

  if (body.maxPerRun !== undefined) {
    propre.maxPerRun = Math.min(100, Math.max(1, Number(body.maxPerRun) || 20));
  }
  if (body.maxPerDay !== undefined) {
    propre.maxPerDay = Math.min(500, Math.max(1, Number(body.maxPerDay) || 60));
  }

  if (body.expiresAt !== undefined) {
    const date = body.expiresAt ? new Date(body.expiresAt) : null;
    propre.expiresAt = date && !Number.isNaN(date.getTime()) ? date : null;
  }

  return propre;
}

export const listAlerts = asyncHandler(async (req, res) => {
  const alerts = await Alert.find({ user: req.user.id }).sort({ createdAt: -1 });
  const appareils = await PushSubscription.countDocuments({ user: req.user.id });

  res.json({
    alerts,
    // De quoi l'interface a besoin pour ne proposer que ce qui marche : sans
    // SMTP le canal courriel est inerte, sans clés VAPID le canal push aussi.
    channels: { ...canaux(), devices: appareils },
  });
});

export const createAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.create({ ...assainir(req.body), user: req.user.id });
  await rescheduleAlerts();
  res.status(201).json(alert);
});

export const updateAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    assainir(req.body),
    { new: true, runValidators: true }
  );
  if (!alert) return res.status(404).json({ error: 'Alerte introuvable' });
  await rescheduleAlerts();
  res.json(alert);
});

export const deleteAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!alert) return res.status(404).json({ error: 'Alerte introuvable' });
  await rescheduleAlerts();
  res.status(204).end();
});

/**
 * POST /alerts/:id/preview — ce que l'alerte trouverait maintenant.
 *
 * Rien n'est envoyé et aucun quota n'est entamé : c'est le seul moyen honnête
 * de vérifier des critères sans attendre l'heure dite. On rend un échantillon,
 * parce qu'un compte peut retenir des centaines de candidatures.
 */
export const previewAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findOne({ _id: req.params.id, user: req.user.id });
  if (!alert) return res.status(404).json({ error: 'Alerte introuvable' });

  const trouvees = await correspondances(alert, null);
  res.json({
    matched: trouvees.length,
    sample: trouvees.slice(0, 10).map((c) => ({
      _id: c._id,
      status: c.status,
      title: c.offer?.title || '',
      company: c.offer?.company || '',
      source: c.offer?.source || '',
    })),
  });
});

/** POST /alerts/:id/run — déclenche l'alerte pour de vrai, tout de suite. */
export const runAlertNow = asyncHandler(async (req, res) => {
  const alert = await Alert.findOne({ _id: req.params.id, user: req.user.id });
  if (!alert) return res.status(404).json({ error: 'Alerte introuvable' });

  const bilan = await runAlert(alert._id, { essai: false, manuel: true });
  res.json({ bilan, alert: await Alert.findById(alert._id) });
});

// --- Notifications du navigateur ---------------------------------------

export const pushKey = asyncHandler(async (_req, res) => {
  res.json({ configured: pushConfigured(), key: publicKey() });
});

export const subscribePush = asyncHandler(async (req, res) => {
  const { endpoint, keys, label } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Abonnement incomplet.' });
  }

  /*
   * Le même appareil peut se réabonner (permission redonnée, cache vidé) : on
   * met à jour plutôt que de refuser, sinon l'unicité de l'`endpoint` ferait
   * échouer une opération parfaitement légitime.
   */
  const abonnement = await PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      user: req.user.id,
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      label: String(label || '').slice(0, 80),
      lastUsedAt: new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ _id: abonnement._id, label: abonnement.label });
});

export const unsubscribePush = asyncHandler(async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant.' });
  await PushSubscription.deleteOne({ endpoint, user: req.user.id });
  res.status(204).end();
});

/** POST /push/test — une notification de contrôle, pour vérifier l'appareil. */
export const testPush = asyncHandler(async (req, res) => {
  const bilan = await notifier(req.user.id, {
    title: 'FindUrJob',
    body: 'Les notifications fonctionnent sur cet appareil.',
    url: '/alertes',
    tag: 'test',
  });
  res.json(bilan);
});
