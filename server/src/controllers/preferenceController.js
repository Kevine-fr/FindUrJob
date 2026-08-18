import cron from 'node-cron';
import SearchPreference from '../models/SearchPreference.js';
import { reschedule } from '../scheduler.js';
import { asyncHandler } from '../middleware.js';

export const getPreferences = asyncHandler(async (req, res) => {
  res.json(await SearchPreference.forUser(req.user.id));
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const preference = await SearchPreference.forUser(req.user.id);

  // Une expression invalide serait acceptée en base puis ignorée en silence par
  // le planificateur : la collecte ne partirait jamais, sans rien dire.
  if (req.body?.syncCron !== undefined && !cron.validate(req.body.syncCron)) {
    return res.status(400).json({
      error:
        `Expression cron invalide : « ${req.body.syncCron} ». ` +
        'Format attendu : minute heure jour mois jour-semaine (ex. 0 7 * * 1-5).',
    });
  }

  Object.assign(preference, req.body);
  await preference.save();

  // Le rythme a pu changer : on reprogramme dans la foulée, sinon la nouvelle
  // valeur n’aurait d’effet qu’au prochain redémarrage du serveur.
  await reschedule();

  res.json(preference);
});
