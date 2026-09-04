import cron from 'node-cron';
import Campaign from './models/Campaign.js';
import SearchPreference from './models/SearchPreference.js';
import { collectOffers } from './controllers/offerController.js';
import { runCampaign } from './services/campaignRunner.js';
import Alert from './models/Alert.js';
import { runAlert } from './services/alertRunner.js';
import { veillerSessions } from './services/sessionWatchdog.js';
import Upkeep from './models/Upkeep.js';
import { relancerLot, verifierAupresDesPlateformes } from './services/upkeep.js';

/**
 * Planificateur des campagnes.
 *
 * Une tâche par utilisateur : chacun a son rythme, son fuseau et ses quotas.
 * Reprogrammer, c'est détruire les tâches existantes et les recréer — sans quoi
 * un changement de rythme empilerait les exécutions.
 */

const tasks = new Map(); // id utilisateur → tâche cron

/*
 * Les alertes vivent dans leur propre registre.
 *
 * Elles se reprogramment a chaque enregistrement d une alerte, bien plus
 * souvent que les campagnes. Les melanger obligerait a tout detruire et tout
 * recreer — y compris des campagnes en cours d execution.
 */
const alertTasks = new Map(); // id alerte → tâche cron

export function stopAlerts() {
  for (const task of alertTasks.values()) task.stop();
  alertTasks.clear();
}

/** (Re)programme toutes les alertes actives et non echues. */
export async function rescheduleAlerts() {
  stopAlerts();

  const alerts = await Alert.find({ enabled: true });

  for (const alert of alerts) {
    if (!cron.validate(alert.cron)) {
      console.warn(`alerte ${alert._id} : expression invalide (${alert.cron})`);
      continue;
    }
    // Une alerte echue ne se reprogramme pas : c est ce que veut dire une
    // echeance. Le premier declenchement suivant l aurait de toute facon
    // eteinte, autant ne pas la reveiller pour rien.
    if (alert.expiresAt && alert.expiresAt.getTime() < Date.now()) continue;

    const id = alert._id.toString();
    const task = cron.schedule(
      alert.cron,
      () => {
        runAlert(id)
          .then((bilan) => console.log(`alerte ${id} :`, JSON.stringify(bilan)))
          .catch((error) => console.error(`alerte ${id} :`, error.message));
      },
      { timezone: alert.timezone || "Europe/Paris" }
    );
    alertTasks.set(id, task);
  }

  return { active: alertTasks.size };
}

export function describeSchedule() {
  return { active: tasks.size, users: [...tasks.keys()], alerts: alertTasks.size };
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

  /*
   * Veille des sessions : toutes les heures, on regarde et on rouvre ce qui est
   * reparable avant que la campagne n en ait besoin. La reconnexion etait
   * jusqu ici reactive — on decouvrait la session morte au moment de
   * candidater, et le tour etait perdu. France Travail expire le plus vite.
   */
  try {
    const veille = cron.schedule(
      "17 * * * *",
      () => {
        veillerSessions()
          .then((bilans) => {
            for (const b of bilans) {
              console.log(
                `veille ${b.user} : rouvertes ${(b.rouvertes || []).join(", ") || "aucune"}` +
                  (b.echouees?.length ? ` · echecs ${b.echouees.join(", ")}` : "")
              );
            }
          })
          .catch((error) => console.error("veille des sessions :", error.message));
      },
      { timezone: "Europe/Paris" }
    );
    tasks.set("veille:sessions", veille);
  } catch (error) {
    console.error("veille des sessions : programmation impossible —", error.message);
  }

  // Les alertes se programment a part : une panne cote campagnes ne doit pas
  // priver de notifications, et l inverse est vrai aussi.
  try {
    const { active } = await rescheduleAlerts();
    console.log(`alertes : ${active} programmee(s)`);
  } catch (error) {
    console.error('alertes : programmation impossible —', error.message);
  }

  // Même isolement : un entretien mal réglé ne doit priver ni de campagnes ni
  // de notifications.
  try {
    const { active } = await rescheduleUpkeep();
    console.log(`entretien : ${active} programme(s)`);
  } catch (error) {
    console.error('entretien : programmation impossible —', error.message);
  }
}

/*
 * L'entretien des candidatures a son propre registre.
 *
 * Il se reprogramme à chaque réglage, bien plus souvent que les campagnes — et
 * les mélanger obligerait à détruire puis recréer des campagnes en cours pour
 * un simple changement de rythme.
 */
const upkeepTasks = new Map(); // « id:travail » → tâche cron

export function stopUpkeep() {
  for (const task of upkeepTasks.values()) task.stop();
  upkeepTasks.clear();
}

/**
 * Programme la relance en lot et la vérification, pour qui les a demandées.
 *
 * Les deux travaux sont programmés séparément, et c'est délibéré : on peut
 * vouloir vérifier chaque matin sans jamais relancer tout seul. La vérification
 * ne fait que lire ce que les plateformes déclarent ; la relance, elle, envoie
 * des candidatures — ce n'est pas le même engagement.
 */
export async function rescheduleUpkeep() {
  stopUpkeep();

  const docs = await Upkeep.find({
    $or: [{ 'retry.enabled': true }, { 'verify.enabled': true }],
  });

  let actives = 0;

  for (const doc of docs) {
    if (!doc.user) continue;
    const user = doc.user.toString();

    for (const [quoi, travail] of [
      ['retry', () => relancerLot(user)],
      ['verify', () => verifierAupresDesPlateformes(user)],
    ]) {
      const reglage = doc[quoi];
      if (!reglage?.enabled) continue;

      if (!cron.validate(reglage.cron)) {
        console.warn(`entretien ${quoi} ${user} : expression invalide (${reglage.cron})`);
        continue;
      }

      const task = cron.schedule(reglage.cron, () => {
        travail()
          .then((bilan) =>
            console.log(`entretien ${quoi} ${user} :`, bilan?.resume || bilan?.skipped || 'fait')
          )
          .catch((error) => console.error(`entretien ${quoi} ${user} :`, error.message));
      });

      upkeepTasks.set(`${user}:${quoi}`, task);
      actives += 1;
    }
  }

  return { active: actives };
}

export function stopScheduler() {
  stopAll();
  stopAlerts();
  stopUpkeep();
}
