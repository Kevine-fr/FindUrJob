import Application from '../models/Application.js';
import { botCandidatures, botConfigured } from './botService.js';

/**
 * Rapprocher nos candidatures de ce que les plateformes disent avoir reçu.
 *
 * Le robot ne conclut à un envoi que s'il *voit* une confirmation. C'est
 * prudent, mais insuffisant : la confirmation s'affiche dans une modale qui se
 * referme, ou son libellé change, ou la page navigue avant qu'on ait pu lire.
 * Tout ce qui n'est pas vu tombe alors en « à vérifier » ou « envoi échoué ».
 *
 * L'écart mesuré est spectaculaire : HelloWork annonce 260 candidatures reçues
 * et LinkedIn 424, quand l'application n'en comptait que deux en « Postulé ».
 * Les envois passaient ; c'est le constat qui manquait.
 *
 * D'où cette passe : on demande à chaque plateforme sa propre liste, et on
 * promeut ce qu'elle reconnaît avoir reçu. Elle ne dégrade jamais un statut —
 * une candidature déjà « Postulé » le reste, et une absence de la liste ne
 * prouve rien (la liste est paginée, la plateforme peut en oublier).
 */

/** La même normalisation que côté robot : sans elle, rien ne se rapproche. */
export function cleRapprochement(titre, societe = '') {
  const nettoyer = (texte) =>
    String(texte || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\((?:h\/f|f\/h|h-f|f-h|m\/f)\)|\b(?:h\/f|f\/h|h-f|f-h|m\/f|w\/m)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  return `${nettoyer(titre)}|${nettoyer(societe)}`;
}

// Les statuts qu'une confirmation peut faire évoluer. « Postulé » n'y est pas :
// on ne repromeut pas ce qui est déjà promu.
const A_CONFIRMER = ['a_verifier', 'echec_envoi', 'a_postuler'];

/*
 * Plateformes qui tiennent une liste lisible. Les autres sont ignorées.
 *
 * France Travail en fait partie depuis qu'on a trouvé sa page — je l'avais
 * cherchée en devinant des adresses et conclu à tort qu'elle n'existait pas.
 * Elle se trouve à `/candidature/mescandidatures`, atteignable depuis une
 * annonce déjà candidatée. Ses envois aboutissaient donc déjà sans jamais
 * pouvoir être confirmés : ils restaient « à vérifier » indéfiniment.
 */
export const AVEC_LISTE = ['hellowork', 'linkedin', 'francetravail', 'welcometothejungle'];

/**
 * @param user     compte concerné
 * @param sources  restreindre à certaines plateformes (toutes par défaut)
 * @param max      profondeur de lecture chez la plateforme
 */
export async function reconcilier(user, { sources = null, max = 200 } = {}) {
  if (!botConfigured()) return { skipped: 'navigateur piloté non configuré' };

  const candidates = await Application.find({ user, status: { $in: A_CONFIRMER } }).populate(
    'offer'
  );
  if (!candidates.length) return { examined: 0, confirmed: 0, parSource: {} };

  // Une lecture par plateforme, pas une par candidature : la liste se parcourt
  // dans un navigateur complet, et la relire pour chaque ligne prendrait des
  // heures pour le même résultat.
  const parSource = {};
  const aTraiter = new Map();

  for (const candidature of candidates) {
    const source = candidature.offer?.source;
    if (!source || !AVEC_LISTE.includes(source)) continue;
    if (sources && !sources.includes(source)) continue;
    if (!aTraiter.has(source)) aTraiter.set(source, []);
    aTraiter.get(source).push(candidature);
  }

  let confirmees = 0;

  for (const [source, lot] of aTraiter) {
    parSource[source] = { examinees: lot.length, confirmees: 0, erreur: null };

    let listees;
    try {
      ({ applications: listees } = await botCandidatures(source, user, max));
    } catch (error) {
      parSource[source].erreur = error.message;
      continue;
    }

    // Deux index : l'identifiant d'offre quand la plateforme le donne (LinkedIn
    // le met dans ses liens, c'est exact), sinon intitulé + société.
    const parId = new Set();
    const parCle = new Set();
    for (const listee of listees || []) {
      if (listee.externalId) parId.add(String(listee.externalId));
      if (listee.titre) parCle.add(cleRapprochement(listee.titre, listee.societe));
    }

    for (const candidature of lot) {
      const offre = candidature.offer;
      const trouvee =
        (offre?.externalId && parId.has(String(offre.externalId))) ||
        (offre?.title && parCle.has(cleRapprochement(offre.title, offre.company)));

      if (!trouvee) continue;

      candidature.status = 'postule';
      candidature.appliedAt = candidature.appliedAt || new Date();
      candidature.timeline.push({
        status: 'postule',
        at: new Date(),
        note: `Confirmé par ${source} : la candidature figure dans « mes candidatures ».`,
      });
      await candidature.save();

      confirmees += 1;
      parSource[source].confirmees += 1;
    }
  }

  return { examined: candidates.length, confirmed: confirmees, parSource };
}

/**
 * Vérifier **une** candidature : cette offre a-t-elle été postulée ?
 *
 * C'est la question que pose « à vérifier », et à laquelle on ne pouvait
 * répondre que de deux façons : lancer la passe complète depuis l'onglet
 * Candidatures, ou aller regarder soi-même sur la plateforme. Depuis la fiche,
 * on ne pouvait que relancer — c'est-à-dire risquer le doublon sans savoir.
 *
 * La lecture reste groupée par plateforme, et c'est délibéré : ouvrir un
 * navigateur complet coûte la même chose pour une ligne que pour trente, et
 * les autres candidatures de la même plateforme profitent du même passage.
 * On dit combien en ont profité plutôt que de le taire.
 *
 * Le verdict « absente » ne dégrade **jamais** le statut. Une liste est
 * paginée, une plateforme peut oublier : l'absence n'est pas une preuve. Elle
 * suffit en revanche à lever le garde-fou anti-doublon de la relance, ce qui
 * est exactement le service rendu.
 */
export async function verifierUne(user, applicationId) {
  const application = await Application.findOne({ _id: applicationId, user }).populate('offer');
  if (!application) {
    const err = new Error('Candidature introuvable.');
    err.status = 404;
    throw err;
  }

  const source = application.offer?.source || null;
  const commun = { source, status: application.status };

  if (application.status === 'postule') {
    return { ...commun, verdict: 'confirmee', deja: true, autres: 0 };
  }

  if (!source) {
    return {
      ...commun,
      verdict: 'impossible',
      raison: "L'annonce n'a plus de plateforme d'origine : il n'y a personne à interroger.",
    };
  }

  if (!AVEC_LISTE.includes(source)) {
    return {
      ...commun,
      verdict: 'impossible',
      raison:
        `${source} ne publie pas de liste « mes candidatures » lisible : personne ne peut ` +
        'répondre à sa place. À regarder sur la plateforme.',
    };
  }

  if (!botConfigured()) {
    return {
      ...commun,
      verdict: 'impossible',
      raison: 'Le navigateur piloté n’est pas configuré : aucune plateforme n’est joignable.',
    };
  }

  const bilan = await reconcilier(user, { sources: [source] });
  const erreur = bilan?.parSource?.[source]?.erreur;
  if (erreur) return { ...commun, verdict: 'erreur', raison: erreur };

  const relu = await Application.findById(application._id).select('status appliedAt');
  const confirmees = bilan?.confirmed || 0;

  if (relu?.status === 'postule') {
    return {
      ...commun,
      status: 'postule',
      verdict: 'confirmee',
      appliedAt: relu.appliedAt,
      // Cette candidature comprise : les autres sont celles qui ont profité du
      // même passage, et l'onglet Candidatures les montrera aussi passées.
      autres: Math.max(0, confirmees - 1),
    };
  }

  /*
   * Absente de la liste. On l'inscrit dans l'historique sans toucher au statut :
   * ce qui compte, c'est de pouvoir dire plus tard « on a regardé, tel jour ».
   */
  application.timeline.push({
    status: application.status,
    at: new Date(),
    note: `Vérifié auprès de ${source} : la candidature ne figure pas dans « mes candidatures ».`,
  });
  await application.save();

  return { ...commun, verdict: 'absente', autres: confirmees };
}
