import Campaign from '../models/Campaign.js';
import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import CVVersion from '../models/CVVersion.js';
import SearchPreference from '../models/SearchPreference.js';
import { tailorCv } from './tailoringService.js';
import { botApply, botConfigured } from './botService.js';
import { BOT_PLATFORMS } from '../utils/constants.js';

/**
 * Une passe de campagne automatique.
 *
 * Le déroulé est volontairement conservateur : on ne postule qu'à ce qui a été
 * scoré au-dessus du seuil, dans la limite du quota, et — sauf mode « envoyer »
 * explicite — on s'arrête au brouillon relu par un humain.
 *
 * La fonction ne lève jamais : une campagne qui échoue doit laisser une trace
 * lisible dans la page, pas faire tomber le planificateur.
 */
export async function runCampaign({ trigger = 'planifié' } = {}) {
  const campaign = await Campaign.getSingleton();

  // Deux exécutions ne doivent pas se chevaucher : une recherche multi-sources
  // peut durer plusieurs minutes, bien plus que l'intervalle le plus court.
  if (campaign.running) {
    return { skipped: 'une exécution est déjà en cours' };
  }

  const { left } = campaign.remainingToday();
  if (left <= 0) {
    return { skipped: `quota quotidien atteint (${campaign.dailyLimit})` };
  }

  campaign.running = true;
  campaign.lastRunAt = new Date();
  await campaign.save();

  const summary = {
    trigger,
    examined: 0,
    prepared: 0,
    sent: 0,
    manual: 0,
    belowScore: 0,
    errors: [],
  };

  try {
    const [profile, prefs] = await Promise.all([
      Profile.getSingleton(),
      SearchPreference.getSingleton(),
    ]);

    // Les offres déjà suivies ne sont pas re-candidatées.
    const known = await Application.find().distinct('offer');

    // On part des offres déjà en base : la synchronisation des sources est un
    // geste séparé, pour que la campagne reste rapide et prévisible.
    const filter = { _id: { $nin: known } };
    if (prefs.contractTypes?.length) filter.contractType = { $in: prefs.contractTypes };
    if (prefs.remotes?.length) filter.remote = { $in: prefs.remotes };

    const budget = Math.min(campaign.perRun, left);
    // On en examine plus que le budget : beaucoup seront écartées au score.
    const candidates = await JobOffer.find(filter).sort({ createdAt: -1 }).limit(budget * 6);

    for (const offer of candidates) {
      if (summary.prepared + summary.sent >= budget) break;
      summary.examined += 1;

      try {
        // Le score vient du moteur IA, avec le CV ciblé : une seule passe.
        const result = await tailorCv({ offer, profile });
        const score = typeof result.score === 'number' ? result.score : 0;

        if (score < campaign.minScore) {
          summary.belowScore += 1;
          continue;
        }

        const at = offer.company ? ` @ ${offer.company}` : '';
        const cv = await CVVersion.create({
          label: `CV — ${offer.title}${at}`,
          kind: 'cible',
          offer: offer._id,
          content: result.content,
          score,
        });

        const application = await Application.create({
          offer: offer._id,
          status: 'a_postuler',
          cvVersion: cv._id,
          coverLetter: result.coverLetter,
          matchScore: score,
          notes: `Préparée automatiquement (campagne ${trigger}).`,
        });

        const sendable =
          campaign.mode === 'envoyer' &&
          botConfigured() &&
          BOT_PLATFORMS.includes(offer.source) &&
          campaign.platforms.includes(offer.source);

        if (!sendable) {
          summary.prepared += 1;
          continue;
        }

        const outcome = await botApply(offer.source, offer);
        if (outcome.status === 'sent') {
          application.status = 'postule';
          application.appliedAt = new Date();
          application.timeline.push({ status: 'postule', note: 'Envoyée par la campagne.' });
          summary.sent += 1;
        } else {
          // « manual » : la plateforme demande des réponses qu'on ne devine pas.
          application.notes += ` — à finir à la main : ${outcome.message || ''}`;
          application.timeline.push({ status: 'a_postuler', note: outcome.message || 'À finir à la main.' });
          summary.manual += 1;
        }
        await application.save();
      } catch (error) {
        // Une offre qui échoue ne doit pas emporter la passe entière.
        summary.errors.push(`${offer.title?.slice(0, 40)} : ${error.message}`);
      }
    }

    const done = summary.prepared + summary.sent;
    if (done > 0) campaign.consume(done);

    campaign.lastResult =
      `${summary.examined} offre(s) examinée(s) · ${summary.prepared} préparée(s) · ` +
      `${summary.sent} envoyée(s)` +
      (summary.manual ? ` · ${summary.manual} à finir à la main` : '') +
      (summary.belowScore ? ` · ${summary.belowScore} sous le seuil` : '');
    campaign.lastError = summary.errors.slice(0, 3).join(' | ');
  } catch (error) {
    campaign.lastError = error.message;
    summary.errors.push(error.message);
  } finally {
    campaign.running = false;
    await campaign.save();
  }

  return summary;
}
