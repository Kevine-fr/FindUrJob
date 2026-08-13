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

    const baseFilter = { _id: { $nin: known } };
    if (prefs.contractTypes?.length) baseFilter.contractType = { $in: prefs.contractTypes };
    if (prefs.remotes?.length) baseFilter.remote = { $in: prefs.remotes };

    // Une file par source, chacune avec son propre quota. On part des offres
    // déjà en base : la synchronisation est un geste séparé, pour que la
    // campagne reste rapide et prévisible.
    const wanted = (campaign.targets || []).filter((target) => target.limit > 0);
    if (!wanted.length) {
      campaign.lastResult = 'Aucune source activée : rien à faire.';
      return { ...summary, skipped: 'aucune source activée' };
    }

    let budget = left;
    const candidates = [];

    for (const target of wanted) {
      if (budget <= 0) break;
      const take = Math.min(target.limit, budget);
      // On en tire plus que le quota : beaucoup seront écartées au score.
      const pool = await JobOffer.find({ ...baseFilter, source: target.source })
        .sort({ createdAt: -1 })
        .limit(take * 6);
      candidates.push({ source: target.source, quota: take, pool });
      budget -= take;
    }

    summary.perSource = {};

    for (const { source, quota, pool } of candidates) {
      let done = 0;
      summary.perSource[source] = { prepared: 0, sent: 0, manual: 0, belowScore: 0 };

      for (const offer of pool) {
        if (done >= quota) break;
        if (summary.prepared + summary.sent >= left) break;
        summary.examined += 1;

        try {
          // Le score vient du moteur IA, avec le CV ciblé : une seule passe.
          const result = await tailorCv({ offer, profile });
          const score = typeof result.score === 'number' ? result.score : 0;

          if (score < campaign.minScore) {
            summary.belowScore += 1;
            summary.perSource[source].belowScore += 1;
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

          done += 1;

          // Seules les plateformes pilotées au navigateur peuvent envoyer :
          // ailleurs, l'annonce renvoie vers un site tiers sans session.
          const sendable =
            campaign.mode === 'envoyer' && botConfigured() && BOT_PLATFORMS.includes(source);

          if (!sendable) {
            summary.prepared += 1;
            summary.perSource[source].prepared += 1;
            continue;
          }

          /*
           * L'envoi a son propre filet.
           *
           * Une session fermée ou un formulaire inattendu ne doit pas effacer le
           * travail déjà fait : la candidature est préparée, elle reste en
           * « à postuler » avec la raison écrite dessus, et elle compte dans le
           * bilan. Sans cette séparation, une erreur d'envoi faisait disparaître
           * du résumé une candidature pourtant bien créée.
           */
          try {
            const outcome = await botApply(source, offer);
            if (outcome.status === 'sent') {
              application.status = 'postule';
              application.appliedAt = new Date();
              application.timeline.push({ status: 'postule', note: 'Envoyée par la campagne.' });
              summary.sent += 1;
              summary.perSource[source].sent += 1;
            } else {
              // « manual » : la plateforme demande des réponses qu'on ne devine pas.
              application.notes += ` — à finir à la main : ${outcome.message || ''}`;
              application.timeline.push({
                status: 'a_postuler',
                note: outcome.message || 'À finir à la main.',
              });
              summary.manual += 1;
              summary.perSource[source].manual += 1;
            }
          } catch (sendError) {
            application.notes += ` — envoi impossible : ${sendError.message}`;
            application.timeline.push({ status: 'a_postuler', note: sendError.message });
            summary.prepared += 1;
            summary.perSource[source].prepared += 1;
            summary.errors.push(`${source} : ${sendError.message}`);
          }

          await application.save();
        } catch (error) {
          // Une offre qui échoue ne doit pas emporter la passe entière.
          summary.errors.push(`${source} · ${offer.title?.slice(0, 32)} : ${error.message}`);
        }
      }
    }

    const total = summary.prepared + summary.sent;
    if (total > 0) campaign.consume(total);

    // Le détail par source est ce qui permet de voir qu'une plateforme
    // n'envoie jamais — un total agrégé le masquerait.
    const detail = Object.entries(summary.perSource)
      .filter(([, counts]) => counts.prepared || counts.sent || counts.manual)
      .map(([name, counts]) => {
        const bits = [
          counts.sent && `${counts.sent} envoyée(s)`,
          counts.prepared && `${counts.prepared} préparée(s)`,
          counts.manual && `${counts.manual} à finir`,
        ].filter(Boolean);
        return `${name} : ${bits.join(', ')}`;
      });

    campaign.lastResult =
      `${summary.examined} offre(s) examinée(s)` +
      (detail.length ? ` — ${detail.join(' · ')}` : ' — aucune retenue') +
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
