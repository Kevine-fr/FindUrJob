import cron from 'node-cron';
import Campaign from './models/Campaign.js';
import { runCampaign } from './services/campaignRunner.js';

/**
 * Planificateur des campagnes.
 *
 * Une tâche par utilisateur : chacun a son rythme, son fuseau et ses quotas.
 * Reprogrammer, c'est détruire les tâches existantes et les recréer — sans quoi
 * un changement de rythme empilerait les exécutions.
 */

const tasks = new Map(); // id utilisateur → tâche cron

export function describeSchedule() {
  return { active: tasks.size, users: [...tasks.keys()] };
}

function stopAll() {
  for (const task of tasks.values()) task.stop();
  tasks.clear();
}

/**
 * (Re)programme toutes les campagnes actives d'après la base.
 * Appelée au démarrage et à chaque enregistrement de réglages.
 */
export async function reschedule() {
  stopAll();

  const campaigns = await Campaign.find({ enabled: true });

  for (const campaign of campaigns) {
    if (!campaign.user) continue;

    if (!cron.validate(campaign.cron)) {
      console.warn(`campagne ${campaign.user} : expression invalide (${campaign.cron})`);
      campaign.lastError = `Expression cron invalide : ${campaign.cron}`;
      await campaign.save();
      continue;
    }

    const user = campaign.user.toString();
    const task = cron.schedule(
      campaign.cron,
      () => {
        runCampaign({ user, trigger: 'planifié' })
          .then((summary) => console.log(`campagne ${user} :`, JSON.stringify(summary)))
          .catch((error) => console.error(`campagne ${user} :`, error.message));
      },
      { timezone: campaign.timezone || 'Europe/Paris' }
    );

    tasks.set(user, task);
  }

  console.log(`campagnes : ${tasks.size} programmée(s)`);
  return describeSchedule();
}

/** Au démarrage du serveur. Une panne ici ne doit pas empêcher l'API de servir. */
export async function startScheduler() {
  try {
    // Un redémarrage pendant une exécution laisserait le drapeau à `true`,
    // et plus aucune campagne ne partirait ensuite.
    await Campaign.updateMany({ running: true }, { running: false });
    await reschedule();
  } catch (error) {
    console.error('campagnes : programmation impossible —', error.message);
  }
}

export const stopScheduler = stopAll;
