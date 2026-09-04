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
const AVEC_LISTE = ['hellowork', 'linkedin', 'francetravail', 'welcometothejungle'];

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
