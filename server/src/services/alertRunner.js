import Alert from '../models/Alert.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { sendMail, appUrl } from './mailer.js';
import { notifier, pushConfigured } from './webPush.js';
import { APPLICATION_STATUSES } from '../utils/constants.js';

/**
 * Exécution d'une alerte.
 *
 * Le principe tient en une phrase : on regarde ce qui a bougé depuis la
 * dernière passe, on garde ce qui correspond aux critères, et on prévient — par
 * courriel, par notification, ou les deux.
 *
 * Comme la campagne, cette fonction ne lève jamais : une alerte en échec doit
 * laisser une trace lisible dans sa fiche, pas faire tomber le planificateur.
 */

/*
 * Combien de lignes un message peut porter.
 *
 * Ce n est pas un quota — c est une limite de lisibilite : passe une trentaine
 * de lignes, un courriel ne se lit plus, il se survole. Le total reel est
 * toujours annonce, et le lien renvoie a la liste complete.
 */
const MAX_LIGNES = 25;

const UNITES_MS = {
  minute: 60_000,
  heure: 3_600_000,
  jour: 86_400_000,
  semaine: 604_800_000,
  mois: 2_592_000_000,
};

/** « 1 candidature correspond » / « 3 candidatures correspondent ». */
function accord(n) {
  return {
    nom: `${n} candidature${n > 1 ? "s" : ""}`,
    verbe: n > 1 ? "correspondent" : "correspond",
  };
}

const LIBELLES = {
  brouillon: 'Brouillon',
  a_postuler: 'À postuler',
  echec_envoi: 'Envoi échoué',
  a_verifier: 'À vérifier',
  postule: 'Postulé',
  relance: 'Relancé',
  entretien: 'Entretien',
  offre: 'Offre',
  refuse: 'Refusé',
  abandonne: 'Abandonné',
};

/**
 * Les candidatures qui correspondent à l'alerte.
 *
 * Statut et fenêtre temporelle se filtrent en base ; plateforme, fraîcheur de
 * l'annonce et concurrence vivent sur l'offre liée et se filtrent après
 * jointure. Le tri exact reproduit celui de l'onglet Candidatures — une alerte
 * qui ne dirait pas la même chose que la page serait pire qu'aucune alerte.
 *
 * `depuis` vaut `null` pour un essai à la demande : on regarde alors tout, sans
 * quoi un essai juste après une exécution ne renverrait jamais rien.
 */
export async function correspondances(alert, depuis) {
  const filtre = { user: alert.user };
  if (alert.statuses?.length) filtre.status = { $in: alert.statuses };
  if (depuis) filtre.updatedAt = { $gt: depuis };

  const candidatures = await Application.find(filtre)
    .populate('offer')
    .sort({ updatedAt: -1 })
    .limit(500);

  const recherche = (alert.q || '').trim().toLowerCase();
  const plancher =
    alert.maxAgeValue > 0
      ? Date.now() - alert.maxAgeValue * (UNITES_MS[alert.maxAgeUnit] || UNITES_MS.jour)
      : null;

  return candidatures.filter((candidature) => {
    const offre = candidature.offer;

    if (alert.sources?.length && !alert.sources.includes(offre?.source)) return false;

    if (plancher) {
      // Sans date de publication, on ne peut pas affirmer que l'offre est
      // récente : on l'écarte plutôt que de la faire passer pour fraîche.
      if (!offre?.publishedAt) return false;
      if (new Date(offre.publishedAt).getTime() < plancher) return false;
    }

    if (alert.maxApplicants !== null && alert.maxApplicants !== undefined) {
      const n = offre?.applicantCount;
      if (typeof n !== 'number' || n > alert.maxApplicants) return false;
    }

    if (recherche) {
      const foin = [offre?.title, offre?.company, offre?.location, candidature.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!foin.includes(recherche)) return false;
    }

    return true;
  });
}

/** Une ligne lisible par candidature, pour le corps du message. */
function ligne(candidature) {
  const offre = candidature.offer;
  return [
    LIBELLES[candidature.status] || candidature.status,
    '·',
    offre?.title || 'Offre supprimée',
    offre?.company ? `— ${offre.company}` : '',
    offre?.location ? `(${offre.location})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function corpsCourriel(alert, lot, total) {
  const base = appUrl();
  const lignes = lot.map((c) => `• ${ligne(c)}\n  ${base}/candidatures`);

  const { nom, verbe } = accord(total);
  const entete =
    lot.length === total
      ? `${nom} ${verbe} à ton alerte « ${alert.name} ».`
      : `${nom} ${verbe} à ton alerte « ${alert.name} ». En voici les ${lot.length} ` +
        `plus récentes.`;

  return [
    entete,
    '',
    ...lignes,
    '',
    `Tout voir : ${base}/candidatures`,
    `Régler cette alerte : ${base}/alertes`,
  ].join('\n');
}

/**
 * Fait tourner une alerte.
 *
 * @param essai  Passe à la demande : on regarde tout, on n'écrit rien, et on
 *               n'entame aucun quota. C'est ce qui permet de vérifier un
 *               réglage sans attendre l'heure dite ni brûler sa journée.
 */
export async function runAlert(alertId, { essai = false, manuel = false } = {}) {
  const alert = await Alert.findById(alertId);
  if (!alert) return { skipped: 'alerte introuvable' };

  if (!essai) {
    if (!alert.enabled) return { skipped: 'alerte désactivée' };

    if (alert.expiree()) {
      alert.enabled = false;
      alert.lastResult = "Échéance atteinte : l'alerte s'est éteinte d'elle-même.";
      await alert.save();
      return { skipped: 'échéance atteinte' };
    }
  }

  try {
    /*
     * Un declenchement a la main regarde tout, pas seulement le nouveau.
     *
     * Sans cela, appuyer sur « Declencher » juste apres avoir cree une alerte
     * renvoyait « aucune nouvelle candidature » — la frontiere du nouveau etant
     * la date de creation de l alerte elle-meme. Le bouton paraissait casse
     * alors qu il faisait exactement ce qu on lui avait demande, et il
     * contredisait l apercu affiche juste au-dessus.
     */
    const trouvees = await correspondances(alert, essai || manuel ? null : alert.lastCheckAt);

    if (!trouvees.length) {
      if (!essai) {
        alert.lastRunAt = new Date();
        alert.lastCheckAt = new Date();
        alert.lastResult = manuel
          ? 'Aucune candidature ne correspond aux criteres.'
          : 'Aucune nouvelle candidature ne correspond.';
        alert.lastError = '';
        await alert.save();
      }
      return { matched: 0, sent: 0, essai };
    }

    const lot = trouvees.slice(0, MAX_LIGNES);

    const resultat = { matched: trouvees.length, notified: lot.length, essai, email: null, push: null };

    if (!essai) {
      const compte = await User.findById(alert.user).select('email').lean();

      if (alert.email && compte?.email) {
        resultat.email = await sendMail({
          to: compte.email,
          subject: `FindUrJob — ${lot.length} candidature${lot.length > 1 ? 's' : ''} · ${alert.name}`,
          text: corpsCourriel(alert, lot, trouvees.length),
        });
      }

      if (alert.push) {
        resultat.push = await notifier(alert.user, {
          title: alert.name,
          body:
            lot.length === 1
              ? ligne(lot[0])
              : `${lot.length} candidatures correspondent à ton alerte.`,
          url: '/candidatures',
          tag: `alerte-${alert._id}`,
        });
      }

      alert.lastRunAt = new Date();
      alert.lastCheckAt = new Date();
      alert.lastError = '';
      alert.lastResult = [
        `${trouvees.length} correspondance${trouvees.length > 1 ? "s" : ""}`,
        `${lot.length} signalée${lot.length > 1 ? 's' : ''}`,
        alert.email ? (resultat.email?.sent ? 'courriel envoyé' : 'courriel non envoyé (SMTP)') : null,
        alert.push ? `push : ${resultat.push?.sent || 0} appareil(s)` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      await alert.save();
    }

    return resultat;
  } catch (error) {
    alert.lastRunAt = new Date();
    alert.lastError = error.message;
    alert.lastResult = `Échec : ${error.message}`;
    await alert.save().catch(() => {});
    return { error: error.message };
  }
}

/** Ce que l'interface a besoin de savoir sur les canaux disponibles. */
export function canaux() {
  return {
    email: Boolean(process.env.SMTP_HOST),
    push: pushConfigured(),
    statuses: APPLICATION_STATUSES,
  };
}
