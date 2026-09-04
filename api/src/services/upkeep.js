import Upkeep from '../models/Upkeep.js';
import Application from '../models/Application.js';
import { retenterCandidature } from './applyRetry.js';
import { reconcilier } from './reconciliation.js';
import { infoEchec } from '../utils/applyFailure.js';
import { journaliser } from './activityLog.js';

/**
 * Les deux travaux d'entretien, menés en fond.
 *
 * Ils partagent la même mécanique — un verrou, un avancement relu par la page,
 * un bilan — parce qu'ils posent le même problème : plusieurs minutes de
 * navigateur, que personne ne peut attendre devant un écran figé.
 *
 * Rien n'est renvoyé à l'appelant : il reçoit un accusé de réception et suit
 * l'avancement en relisant le document. C'est ce qui rend le geste supportable
 * sur trente candidatures.
 */

/**
 * Un verrou qui s'ouvre tout seul si le service est tombé au milieu.
 *
 * Sans cette péremption, une coupure pendant une relance laisserait `running`
 * à vrai pour toujours, et le bouton resterait grisé sans que rien ne tourne.
 * Deux heures : bien au-delà du plus long travail imaginable ici.
 */
const PEREMPTION = 2 * 60 * 60 * 1000;

const bloque = (travail) =>
  Boolean(travail?.running) && Date.now() - new Date(travail.startedAt || 0).getTime() < PEREMPTION;

/** Écrit l'avancement sans relire le document : la page le relit, elle. */
const avancer = (user, quoi, champs) =>
  Upkeep.updateOne(
    { user },
    { $set: Object.fromEntries(Object.entries(champs).map(([c, v]) => [`${quoi}.${c}`, v])) }
  ).catch(() => {});

/** Les candidatures qu'une relance peut reprendre, les plus prometteuses d'abord. */
export async function relancables(user, { max = 10 } = {}) {
  const candidates = await Application.find({
    user,
    status: { $in: ['echec_envoi', 'a_verifier'] },
  })
    .populate('offer', 'title company sourceUrl source')
    .sort({ updatedAt: -1 })
    .limit(300);

  return candidates
    .filter((a) => {
      // Sans annonce ni adresse, il n'y a nulle part où renvoyer.
      if (!a.offer?.sourceUrl) return false;
      /*
       * Une cause qu'une relance ne lève pas ne se relance pas en lot.
       *
       * Un captcha opposera le même mur et une annonce qui renvoie vers l'outil
       * du recruteur n'a rien à recevoir ici : les reprendre en masse ne ferait
       * que consommer des minutes de navigateur pour le même refus. Le bouton
       * de la fiche, lui, garde la possibilité de forcer au cas par cas.
       */
      const cause = a.lastFailure?.reason;
      return !cause || infoEchec(cause).retentable;
    })
    .slice(0, max);
}

/**
 * Relance en lot.
 *
 * On ne force jamais : « à vérifier » n'est repris que si la plateforme tient
 * une liste et n'y trouve rien. C'est le service de reprise qui en décide, et
 * il refuse de lui-même le reste — ce refus est un succès du garde-fou, pas une
 * erreur, et il est compté à part.
 */
export async function relancerLot(user, { max } = {}) {
  const doc = await Upkeep.forUser(user);
  if (bloque(doc.retry)) return { skipped: 'une relance est déjà en cours' };

  const plafond = Math.min(Number(max) || doc.retryMax || 10, 100);
  const liste = await relancables(user, { max: plafond });

  await avancer(user, 'retry', {
    running: true,
    startedAt: new Date(),
    done: 0,
    total: liste.length,
    step: liste.length ? 'Démarrage…' : 'Rien à relancer',
  });

  const bilan = { reprises: liste.length, envoyees: 0, echouees: 0, refusees: 0, details: [] };

  try {
    for (const [index, application] of liste.entries()) {
      await avancer(user, 'retry', {
        done: index,
        step: `${application.offer?.title || 'Candidature'} — ${application.offer?.company || ''}`.trim(),
      });

      try {
        const issue = await retenterCandidature(user, application._id.toString());
        if (issue.categorie === 'sent') bilan.envoyees += 1;
        else bilan.echouees += 1;
        bilan.details.push({
          offre: application.offer?.title || '',
          categorie: issue.categorie,
          message: issue.message,
        });
      } catch (erreur) {
        // Un refus du garde-fou (double envoi possible, cause non retentable,
        // plafond atteint) n'est pas une panne : on le compte pour ce qu'il est.
        bilan.refusees += 1;
        bilan.details.push({
          offre: application.offer?.title || '',
          categorie: 'refusee',
          message: erreur.message,
        });
      }
    }

    const resume = liste.length
      ? `${bilan.envoyees} envoyée(s), ${bilan.echouees} sans succès, ${bilan.refusees} écartée(s).`
      : 'Aucune candidature à relancer.';

    await avancer(user, 'retry', {
      running: false,
      done: liste.length,
      step: '',
      lastAt: new Date(),
      lastResult: resume,
    });

    if (liste.length) {
      await journaliser(user, 'candidature.relance', {
        severity: bilan.envoyees ? 'info' : 'avertissement',
        summary: `Relance en lot : ${resume}`,
        detail: bilan,
      }).catch(() => {});
    }

    return { ...bilan, resume };
  } catch (erreur) {
    await avancer(user, 'retry', {
      running: false,
      step: '',
      lastAt: new Date(),
      lastResult: `Interrompue : ${erreur.message}`,
    });
    throw erreur;
  }
}

/** Vérification auprès des plateformes, menée de la même façon. */
export async function verifierAupresDesPlateformes(user, { sources = null, max = 200 } = {}) {
  const doc = await Upkeep.forUser(user);
  if (bloque(doc.verify)) return { skipped: 'une vérification est déjà en cours' };

  await avancer(user, 'verify', {
    running: true,
    startedAt: new Date(),
    done: 0,
    total: 0,
    step: 'Lecture des plateformes…',
  });

  try {
    const bilan = await reconcilier(user, { sources, max });
    const resume = `${bilan.confirmed} candidature(s) confirmée(s) sur ${bilan.examined} examinée(s).`;

    await avancer(user, 'verify', {
      running: false,
      done: bilan.examined,
      total: bilan.examined,
      step: '',
      lastAt: new Date(),
      lastResult: resume,
    });

    if (bilan.examined) {
      await journaliser(user, 'candidature.verification', {
        severity: bilan.confirmed ? 'succes' : 'info',
        summary: `Vérification auprès des plateformes : ${resume}`,
        detail: bilan,
      }).catch(() => {});
    }

    return { ...bilan, resume };
  } catch (erreur) {
    await avancer(user, 'verify', {
      running: false,
      step: '',
      lastAt: new Date(),
      lastResult: `Interrompue : ${erreur.message}`,
    });
    throw erreur;
  }
}
