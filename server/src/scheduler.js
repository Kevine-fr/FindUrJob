import cron from 'node-cron';
import Campaign from './models/Campaign.js';
import SearchPreference from './models/SearchPreference.js';
import { collectOffers } from './controllers/offerController.js';
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


  /*
   * La collecte d'offres a son propre rythme.
   *
   * Elle est distincte de la campagne : on veut un vivier frais le matin, et
   * candidater plus tard dans la journée. Les lier forcerait à choisir entre
   * chercher trop souvent ou postuler trop rarement.
   */
  const prefs = await SearchPreference.find({ autoSync: true });

  for (const pref of prefs) {
    if (!pref.user) continue;

    if (!cron.validate(pref.syncCron)) {
      console.warn(`collecte ${pref.user} : expression invalide (${pref.syncCron})`);
      continue;
    }

    const user = pref.user.toString();
    const task = cron.schedule(
      pref.syncCron,
      () => {
        collectOffers(user)
          .then(async (bilan) => {
            console.log(`collecte ${user} :`, JSON.stringify(bilan));
            // Le bilan s'affiche dans la page Préférences : sans trace, une
            // collecte programmée est indiscernable d'une collecte absente.
            await SearchPreference.updateOne(
              { _id: pref._id },
              {
                lastSyncAt: new Date(),
                lastSyncResult:
                  `${bilan.imported} nouvelle(s), ${bilan.updated} mise(s) à jour, ` +
                  `${bilan.found} trouvée(s).`,
              }
            );
          })
          .catch(async (error) => {
            console.error(`collecte ${user} :`, error.message);
            await SearchPreference.updateOne(
              { _id: pref._id },
              { lastSyncAt: new Date(), lastSyncResult: `Échec : ${error.message}` }
            );
          });
      },
      { timezone: 'Europe/Paris' }
    );

    // Clé distincte de celle de la campagne : un même compte peut avoir les
    // deux tâches, et `stopAll` doit pouvoir arrêter les deux.
    tasks.set(`sync:${user}`, task);
  }

  console.log(`campagnes : ${campaigns.length} programmée(s) · collectes : ${prefs.length}`);
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
