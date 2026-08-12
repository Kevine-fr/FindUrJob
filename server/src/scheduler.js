import cron from 'node-cron';
import Campaign from './models/Campaign.js';
import { runCampaign } from './services/campaignRunner.js';

/**
 * Planificateur des campagnes.
 *
 * Une seule tâche vit à la fois : reprogrammer, c'est détruire l'ancienne et
 * en créer une neuve. Sans ça, changer de rythme empilerait les exécutions.
 */

let task = null;
let current = { cron: null, timezone: null, enabled: false };

export function describeSchedule() {
  return { ...current, active: Boolean(task) };
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

/**
 * (Re)programme la campagne d'après le document en base.
 * Appelée au démarrage et à chaque enregistrement des réglages.
 */
export async function reschedule() {
  const campaign = await Campaign.getSingleton();
  stop();
  current = { cron: campaign.cron, timezone: campaign.timezone, enabled: campaign.enabled };

  if (!campaign.enabled) {
    console.log('campagne : désactivée');
    return describeSchedule();
  }

  if (!cron.validate(campaign.cron)) {
    console.warn(`campagne : expression cron invalide (${campaign.cron}) — non programmée`);
    campaign.lastError = `Expression cron invalide : ${campaign.cron}`;
    await campaign.save();
    return describeSchedule();
  }

  task = cron.schedule(
    campaign.cron,
    () => {
      runCampaign({ trigger: 'planifié' })
        .then((summary) => console.log('campagne :', JSON.stringify(summary)))
        .catch((error) => console.error('campagne :', error));
    },
    { timezone: campaign.timezone || 'Europe/Paris' }
  );

  console.log(`campagne : programmée « ${campaign.cron} » (${campaign.timezone})`);
  return describeSchedule();
}

/** Au démarrage du serveur. Une panne ici ne doit pas empêcher l'API de servir. */
export async function startScheduler() {
  try {
    // Un redémarrage pendant une exécution laisserait le drapeau à `true`,
    // et plus aucune campagne ne partirait ensuite.
    await Campaign.updateOne({}, { running: false });
    await reschedule();
  } catch (error) {
    console.error('campagne : programmation impossible —', error.message);
  }
}

export function stopScheduler() {
  stop();
}
