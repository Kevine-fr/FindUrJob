import mongoose from 'mongoose';
import Application from '../models/Application.js';
import CVVersion from '../models/CVVersion.js';
import JobOffer from '../models/JobOffer.js';
import Alert from '../models/Alert.js';
import Campaign from '../models/Campaign.js';
import PlatformAccount from '../models/PlatformAccount.js';
import PushSubscription from '../models/PushSubscription.js';
import User from '../models/User.js';
import ActivityEvent from '../models/ActivityEvent.js';
import { SOURCE_ORIGINE, categorieDe } from '../utils/activity.js';

/**
 * Le fil d'activité d'un compte, toutes origines confondues.
 *
 * Deux moitiés, assemblées ici :
 *
 *   — **Reconstitué** depuis les collections métier. La timeline d'une
 *     candidature, la date d'un CV, celle d'une offre sont déjà là : les relire
 *     donne un historique rétroactif, sans migration ni attente.
 *
 *   — **Journalisé** dans `ActivityEvent`. Seul moyen de garder ce qu'aucun
 *     document ne conserve : une campagne n'a qu'un `lastRunAt`, chaque passe
 *     écrase la précédente.
 *
 * Chaque évènement porte son `origine`, pour que l'interface puisse dire
 * honnêtement jusqu'où l'historique remonte selon la famille.
 *
 * Toutes les lectures sont bornées par la période demandée : sans cela, ouvrir
 * la page sur un compte à trois cent mille candidatures les chargerait toutes.
 */

/** Plafond par source, pour qu'une seule famille ne noie pas les autres. */
const PLAFOND_PAR_SOURCE = 500;

/** Borne `champ` sur la période, sous une forme directement injectable. */
function borne(champ, from, to) {
  const contrainte = {};
  if (from) contrainte.$gte = from;
  if (to) contrainte.$lte = to;
  return Object.keys(contrainte).length ? { [champ]: contrainte } : {};
}

/** L'évènement tombe-t-il dans la période ? Pour les dates lues hors requête. */
function dansPeriode(date, from, to) {
  if (!date) return false;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

/** Résumé d'offre embarqué dans un évènement, pour éviter un second appel. */
function resumeOffre(offre) {
  if (!offre) return null;
  return {
    _id: offre._id,
    title: offre.title,
    company: offre.company,
    source: offre.source,
  };
}

// --- Sources reconstituées ------------------------------------------------

/** Changements de statut, déjà journalisés dans `Application.timeline`. */
async function depuisCandidatures(user, from, to) {
  const applications = await Application.find({
    user,
    // Réduit d'abord les documents : inutile de rapatrier une candidature dont
    // aucune entrée ne tombe dans la période.
    ...(from || to ? { timeline: { $elemMatch: borne('at', from, to) } } : {}),
  })
    .populate('offer', 'title company source')
    .sort({ updatedAt: -1 })
    .limit(PLAFOND_PAR_SOURCE);

  const evenements = [];
  for (const application of applications) {
    for (const entree of application.timeline || []) {
      if (!dansPeriode(entree.at, from, to)) continue;
      evenements.push({
        at: entree.at,
        categorie: 'candidature',
        type: 'candidature.statut',
        titre: entree.status,
        statut: entree.status,
        resume: entree.note || '',
        gravite: entree.status === 'echec_envoi' ? 'erreur' : 'info',
        origine: SOURCE_ORIGINE.reconstitue,
        applicationId: application._id,
        offre: resumeOffre(application.offer),
      });
    }
  }
  return evenements;
}

/** CV produits ou importés, et ceux effectivement partis. */
async function depuisCv(user, from, to) {
  // Un CV compte deux fois : quand il est écrit, et quand il part. L'un des
  // deux peut tomber dans la période sans l'autre, d'où le `$or`.
  const parCreation = borne('createdAt', from, to);
  const parEnvoi = borne('sentAt', from, to);
  const periode = Object.keys(parCreation).length ? { $or: [parCreation, parEnvoi] } : {};

  const versions = await CVVersion.find({ user, ...periode })
    .populate('offer', 'title company source')
    .sort({ createdAt: -1 })
    .limit(PLAFOND_PAR_SOURCE);

  const evenements = [];
  for (const version of versions) {
    if (dansPeriode(version.createdAt, from, to)) {
      evenements.push({
        at: version.createdAt,
        categorie: 'cv',
        type: version.kind === 'maitre' ? 'cv.maitre' : 'cv.cible',
        titre: version.kind === 'maitre' ? 'CV de référence enregistré' : 'CV ciblé généré',
        resume: version.label || '',
        score: typeof version.score === 'number' ? version.score : null,
        gravite: 'info',
        origine: SOURCE_ORIGINE.reconstitue,
        cvVersionId: version._id,
        offre: resumeOffre(version.offer),
      });
    }
    // Un CV parti est un geste distinct de sa rédaction, souvent à un autre moment.
    if (version.sentAt && dansPeriode(version.sentAt, from, to)) {
      evenements.push({
        at: version.sentAt,
        categorie: 'cv',
        type: 'cv.envoi',
        titre: 'CV envoyé',
        resume: version.label || '',
        gravite: 'succes',
        origine: SOURCE_ORIGINE.reconstitue,
        cvVersionId: version._id,
        offre: resumeOffre(version.offer),
      });
    }
  }
  return evenements;
}

/**
 * Offres collectées, regroupées par jour et par plateforme.
 *
 * Une ligne par offre noierait tout le reste — une passe en ramène des
 * centaines. Le volume quotidien est l'information utile ; l'onglet Offres
 * reste là pour le détail.
 */
async function depuisOffres(user, from, to) {
  const lignes = await JobOffer.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(user)), ...borne('createdAt', from, to) } },
    {
      $group: {
        _id: {
          jour: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          source: '$source',
        },
        n: { $sum: 1 },
        derniere: { $max: '$createdAt' },
      },
    },
    { $sort: { derniere: -1 } },
    { $limit: PLAFOND_PAR_SOURCE },
  ]);

  return lignes.map((ligne) => ({
    at: ligne.derniere,
    categorie: 'offre',
    type: 'offre.collecte',
    titre: `${ligne.n} offre${ligne.n > 1 ? 's' : ''} collectée${ligne.n > 1 ? 's' : ''}`,
    resume: '',
    gravite: 'info',
    origine: SOURCE_ORIGINE.reconstitue,
    plateforme: ligne._id.source,
    detail: { jour: ligne._id.jour, nombre: ligne.n },
  }));
}

/** Alertes : leur création, et leur dernière passe si le journal est vide. */
async function depuisAlertes(user, from, to) {
  const alertes = await Alert.find({ user }).limit(PLAFOND_PAR_SOURCE);
  const evenements = [];

  for (const alerte of alertes) {
    if (dansPeriode(alerte.createdAt, from, to)) {
      evenements.push({
        at: alerte.createdAt,
        categorie: 'alerte',
        type: 'alerte.creation',
        titre: 'Alerte créée',
        resume: alerte.name || '',
        gravite: 'info',
        origine: SOURCE_ORIGINE.reconstitue,
        alertId: alerte._id,
      });
    }
    /*
     * La dernière passe n'est reprise ici que parce qu'elle est tout ce que le
     * document garde. Le journal, lui, conserve chacune : les deux se
     * recouvrent donc sur la période récente, et le dédoublonnage plus bas
     * écarte la ligne reconstituée quand la ligne journalisée existe.
     */
    if (alerte.lastRunAt && dansPeriode(alerte.lastRunAt, from, to)) {
      evenements.push({
        at: alerte.lastRunAt,
        categorie: 'alerte',
        type: 'alerte.execution',
        titre: 'Alerte exécutée',
        resume: alerte.lastError || alerte.lastResult || '',
        gravite: alerte.lastError ? 'erreur' : 'info',
        origine: SOURCE_ORIGINE.reconstitue,
        alertId: alerte._id,
        dedoublonnable: true,
      });
    }
  }
  return evenements;
}

/** Campagne : sa mise en place, et sa dernière passe faute de mieux. */
async function depuisCampagne(user, from, to) {
  const campagne = await Campaign.findOne({ user });
  if (!campagne) return [];

  const evenements = [];
  if (dansPeriode(campagne.createdAt, from, to)) {
    evenements.push({
      at: campagne.createdAt,
      categorie: 'campagne',
      type: 'campagne.creation',
      titre: 'Campagne configurée',
      resume: `Rythme ${campagne.cron}, mode « ${campagne.mode} »`,
      gravite: 'info',
      origine: SOURCE_ORIGINE.reconstitue,
    });
  }
  if (campagne.lastRunAt && dansPeriode(campagne.lastRunAt, from, to)) {
    evenements.push({
      at: campagne.lastRunAt,
      categorie: 'campagne',
      type: 'campagne.execution',
      titre: 'Campagne exécutée',
      resume: campagne.lastError || campagne.lastResult || '',
      gravite: campagne.lastError ? 'erreur' : 'succes',
      origine: SOURCE_ORIGINE.reconstitue,
      dedoublonnable: true,
    });
  }
  return evenements;
}

/** Comptes de plateformes : ouverture de session et dernière vérification. */
async function depuisComptes(user, from, to) {
  const comptes = await PlatformAccount.find({ user }).limit(PLAFOND_PAR_SOURCE);
  const evenements = [];

  for (const compte of comptes) {
    if (dansPeriode(compte.createdAt, from, to)) {
      evenements.push({
        at: compte.createdAt,
        categorie: 'compte',
        type: 'compte.ajout',
        titre: 'Compte de plateforme ajouté',
        resume: compte.email || '',
        gravite: 'info',
        origine: SOURCE_ORIGINE.reconstitue,
        plateforme: compte.platform,
      });
    }
    if (compte.lastLoginAt && dansPeriode(compte.lastLoginAt, from, to)) {
      evenements.push({
        at: compte.lastLoginAt,
        categorie: 'compte',
        type: 'compte.session',
        titre: 'Session de plateforme ouverte',
        resume: compte.lastMessage || '',
        gravite: compte.sessionStatus === 'erreur' ? 'erreur' : 'succes',
        origine: SOURCE_ORIGINE.reconstitue,
        plateforme: compte.platform,
        dedoublonnable: true,
      });
    }
  }
  return evenements;
}

/** Le compte lui-même : inscription, dernière connexion, abonnements push. */
async function depuisCompteUtilisateur(user, from, to) {
  const [personne, abonnements] = await Promise.all([
    User.findById(user).select('createdAt lastLoginAt loginCount emailVerifiedAt'),
    PushSubscription.find({ user }).select('createdAt').limit(50),
  ]);
  if (!personne) return [];

  const evenements = [];
  if (dansPeriode(personne.createdAt, from, to)) {
    evenements.push({
      at: personne.createdAt,
      categorie: 'session',
      type: 'session.inscription',
      titre: 'Compte créé',
      resume: '',
      gravite: 'succes',
      origine: SOURCE_ORIGINE.reconstitue,
    });
  }
  if (personne.emailVerifiedAt && dansPeriode(personne.emailVerifiedAt, from, to)) {
    evenements.push({
      at: personne.emailVerifiedAt,
      categorie: 'session',
      type: 'session.verification',
      titre: 'Adresse e-mail vérifiée',
      resume: '',
      gravite: 'succes',
      origine: SOURCE_ORIGINE.reconstitue,
    });
  }
  if (personne.lastLoginAt && dansPeriode(personne.lastLoginAt, from, to)) {
    evenements.push({
      at: personne.lastLoginAt,
      categorie: 'session',
      type: 'session.connexion',
      titre: 'Connexion',
      resume: personne.loginCount ? `${personne.loginCount} connexion(s) au total` : '',
      gravite: 'info',
      origine: SOURCE_ORIGINE.reconstitue,
      dedoublonnable: true,
    });
  }
  for (const abonnement of abonnements) {
    if (!dansPeriode(abonnement.createdAt, from, to)) continue;
    evenements.push({
      at: abonnement.createdAt,
      categorie: 'session',
      type: 'session.notification',
      titre: 'Appareil abonné aux notifications',
      resume: '',
      gravite: 'info',
      origine: SOURCE_ORIGINE.reconstitue,
    });
  }
  return evenements;
}

// --- Source journalisée ---------------------------------------------------

async function depuisJournal(user, from, to) {
  const lignes = await ActivityEvent.find({ user, ...borne('at', from, to) })
    .populate('offer', 'title company source')
    .sort({ at: -1 })
    .limit(PLAFOND_PAR_SOURCE * 2);

  return lignes.map((ligne) => ({
    at: ligne.at,
    categorie: categorieDe(ligne.kind),
    type: ligne.kind,
    titre: ligne.summary || ligne.kind,
    resume: '',
    gravite: ligne.severity,
    origine: SOURCE_ORIGINE.journalise,
    detail: ligne.detail,
    offre: resumeOffre(ligne.offer),
    applicationId: ligne.application || undefined,
    alertId: ligne.alert || undefined,
  }));
}

// --- Assemblage -----------------------------------------------------------

/**
 * Assemble le fil complet d'un compte.
 *
 * `categories` restreint aux familles demandées — et **avant** les requêtes :
 * filtrer après coup ferait payer la lecture de tout ce qu'on jette.
 */
export async function construireHistorique(
  user,
  { from = null, to = null, categories = null, q = '', limit = 200, skip = 0 } = {}
) {
  const veut = (categorie) => !categories?.length || categories.includes(categorie);

  const lots = await Promise.all([
    veut('candidature') ? depuisCandidatures(user, from, to) : [],
    veut('cv') ? depuisCv(user, from, to) : [],
    veut('offre') ? depuisOffres(user, from, to) : [],
    veut('alerte') ? depuisAlertes(user, from, to) : [],
    veut('campagne') ? depuisCampagne(user, from, to) : [],
    veut('compte') ? depuisComptes(user, from, to) : [],
    veut('session') || veut('profil') ? depuisCompteUtilisateur(user, from, to) : [],
    depuisJournal(user, from, to),
  ]);

  return assembler(lots.flat(), { categories, q, limit, skip });
}

/**
 * Fusion, dédoublonnage, tri, comptage, pagination.
 *
 * Séparée des requêtes et exportée : c'est la partie où se logent les erreurs
 * subtiles — un doublon qui passe, un tri instable, un compteur calculé sur la
 * page plutôt que sur l'ensemble — et la seule qu'on puisse éprouver sans base
 * de données, en lui donnant des tableaux fabriqués.
 */
export function assembler(evenementsBruts, { categories = null, q = '', limit = 200, skip = 0 } = {}) {
  let evenements = evenementsBruts;

  /*
   * Le journal fait autorité.
   *
   * Un geste journalisé et sa reconstitution décrivent la même chose : la
   * campagne d'hier soir apparaît à la fois dans `ActivityEvent` et dans le
   * `lastRunAt` du document. On écarte la reconstitution — mais seulement
   * celles marquées `dedoublonnable`, c'est-à-dire celles dont on sait qu'un
   * équivalent journalisé peut exister.
   *
   * La comparaison est faite à la seconde : les deux écritures viennent du même
   * `new Date()`, mais rien ne garantit l'égalité à la milliseconde une fois
   * les dates passées par Mongo.
   */
  const empreinte = (e) => `${e.type}|${new Date(e.at).toISOString().slice(0, 19)}`;
  const empreintesJournal = new Set(
    evenements.filter((e) => e.origine === SOURCE_ORIGINE.journalise).map(empreinte)
  );
  evenements = evenements.filter((e) => !e.dedoublonnable || !empreintesJournal.has(empreinte(e)));

  if (categories?.length) evenements = evenements.filter((e) => categories.includes(e.categorie));

  const recherche = String(q || '').trim().toLowerCase();
  if (recherche) {
    evenements = evenements.filter((e) =>
      [e.titre, e.resume, e.offre?.title, e.offre?.company, e.plateforme]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(recherche)
    );
  }

  evenements = [...evenements].sort((a, b) => new Date(b.at) - new Date(a.at));

  // Compte par famille sur l'ensemble filtré, pas sur la page : les puces de
  // filtre doivent annoncer ce qui existe, pas ce qui tient dans l'écran.
  const parCategorie = {};
  for (const evenement of evenements) {
    parCategorie[evenement.categorie] = (parCategorie[evenement.categorie] || 0) + 1;
  }

  const plafond = Math.min(Number(limit) || 200, 1000);
  const depart = Math.max(0, Number(skip) || 0);

  return {
    total: evenements.length,
    parCategorie,
    events: evenements.slice(depart, depart + plafond).map((evenement, index) => ({
      ...evenement,
      // Identifiant stable pour la clé de liste : date + type + rang suffisent,
      // les évènements reconstitués n'ayant pas d'identité propre.
      id: `${new Date(evenement.at).getTime()}-${evenement.type}-${depart + index}`,
      dedoublonnable: undefined,
    })),
  };
}
