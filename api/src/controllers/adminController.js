import mongoose from 'mongoose';
import User from '../models/User.js';
import JobOffer from '../models/JobOffer.js';
import Application from '../models/Application.js';
import CVVersion from '../models/CVVersion.js';
import Campaign from '../models/Campaign.js';
import PlatformAccount from '../models/PlatformAccount.js';
import ActivityEvent from '../models/ActivityEvent.js';
import { asyncHandler } from '../middleware.js';
import { reschedule } from '../scheduler.js';
import { construireHistorique } from '../services/historyService.js';
import { lireDate, lireCategories } from './historyController.js';

/**
 * Console d'administration : lecture de tout le flux, gestion des comptes.
 *
 * Les agrégations tournent en base plutôt qu'en mémoire : compter 300 000
 * candidatures en JavaScript reviendrait à toutes les transférer.
 */

const jours = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

/** Série journalière sur `days` jours, trous comblés à zéro. */
async function serieParJour(Model, { days = 30, match = {}, field = 'createdAt' } = {}) {
  const depuis = jours(days);

  const lignes = await Model.aggregate([
    { $match: { ...match, [field]: { $gte: depuis } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}` } },
        n: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Une série à trous se lit mal : un jour sans activité vaut zéro, pas rien.
  const parJour = new Map(lignes.map((l) => [l._id, l.n]));
  const serie = [];
  for (let i = days - 1; i >= 0; i--) {
    const cle = jours(i).toISOString().slice(0, 10);
    serie.push({ date: cle, value: parJour.get(cle) || 0 });
  }
  return serie;
}

/** Répartition par valeur d'un champ, la plus grosse d'abord. */
async function repartition(Model, field, match = {}) {
  const lignes = await Model.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  return lignes.filter((l) => l._id != null).map((l) => ({ key: String(l._id), value: l.n }));
}

/**
 * GET /admin/overview — tout ce qu'il faut pour le tableau de bord.
 *
 * Une seule route plutôt qu'une par graphique : la page les affiche ensemble,
 * et dix allers-retours pour une seule vue seraient dix fois plus lents.
 */
export const overview = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);

  const [
    utilisateurs,
    actifs,
    admins,
    offres,
    candidatures,
    cvs,
    campagnesActives,
    sessionsOuvertes,
    envoyees,
    entretiens,
    inscriptions,
    candidaturesParJour,
    offresParJour,
    parSource,
    parStatut,
    parContrat,
    parTeletravail,
    fraicheur,
    scores,
    poidsPdf,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ active: true }),
    User.countDocuments({ role: 'admin' }),
    JobOffer.countDocuments(),
    Application.countDocuments(),
    CVVersion.countDocuments(),
    Campaign.countDocuments({ enabled: true }),
    PlatformAccount.countDocuments({ sessionState: 'connectee' }),
    Application.countDocuments({ status: 'postule' }),
    Application.countDocuments({ status: 'entretien' }),
    serieParJour(User, { days }),
    serieParJour(Application, { days }),
    serieParJour(JobOffer, { days }),
    repartition(JobOffer, 'source'),
    repartition(Application, 'status'),
    repartition(JobOffer, 'contractType'),
    repartition(JobOffer, 'remote'),
    JobOffer.aggregate([
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $eq: [{ $ifNull: ["$publishedAt", null] }, null] }, then: "inconnue" },
                { case: { $gte: ["$publishedAt", jours(2)] }, then: "moins de 2 jours" },
                { case: { $gte: ["$publishedAt", jours(7)] }, then: "moins d une semaine" },
                { case: { $gte: ["$publishedAt", jours(30)] }, then: "moins d un mois" },
              ],
              default: "plus d un mois",
            },
          },
          n: { $sum: 1 },
        },
      },
      { $sort: { n: -1 } },
    ]),
    Application.aggregate([
      { $match: { matchScore: { $ne: null } } },
      { $group: { _id: null, moyenne: { $avg: '$matchScore' }, n: { $sum: 1 } } },
    ]),
    CVVersion.aggregate([{ $group: { _id: null, octets: { $sum: '$pdfBytes' } } }]),
  ]);

  res.json({
    days,
    totaux: {
      utilisateurs,
      actifs,
      admins,
      offres,
      candidatures,
      cvs,
      campagnesActives,
      sessionsOuvertes,
      envoyees,
      entretiens,
      // Le taux d'envoi dit ce que la préparation devient réellement.
      tauxEnvoi: candidatures ? Math.round((envoyees / candidatures) * 100) : 0,
      scoreMoyen: scores[0] ? Math.round(scores[0].moyenne) : null,
      pdfMo: poidsPdf[0] ? +(poidsPdf[0].octets / 1024 / 1024).toFixed(1) : 0,
    },
    series: { inscriptions, candidatures: candidaturesParJour, offres: offresParJour },
    repartitions: {
      source: parSource,
      statut: parStatut,
      contrat: parContrat,
      teletravail: parTeletravail,
      // Fraîcheur du stock : un vivier majoritairement ancien explique un
      // faible taux de réponse mieux que n importe quelle autre métrique.
      fraicheur: fraicheur.map((l) => ({ key: l._id, value: l.n })),
    },
  });
});

/**
 * GET /admin/users — la liste, avec ce que chacun a produit.
 *
 * Les compteurs viennent d'agrégations groupées, pas d'une requête par
 * utilisateur : cent comptes feraient sinon trois cents allers-retours.
 */
export const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 });

  const compter = async (Model, match = {}) => {
    const lignes = await Model.aggregate([
      { $match: match },
      { $group: { _id: '$user', n: { $sum: 1 } } },
    ]);
    return new Map(lignes.map((l) => [String(l._id), l.n]));
  };

  const [offres, candidatures, envoyees, cvs, campagnes] = await Promise.all([
    compter(JobOffer),
    compter(Application),
    compter(Application, { status: 'postule' }),
    compter(CVVersion),
    compter(Campaign, { enabled: true }),
  ]);

  res.json({
    users: users.map((user) => {
      const id = user._id.toString();
      return {
        ...user.toPublic(),
        stats: {
          offres: offres.get(id) || 0,
          candidatures: candidatures.get(id) || 0,
          envoyees: envoyees.get(id) || 0,
          cvs: cvs.get(id) || 0,
          campagneActive: (campagnes.get(id) || 0) > 0,
        },
      };
    }),
  });
});

/**
 * GET /admin/users/:id/activity — le fil d'un compte, vu par un administrateur.
 *
 * Même service que l'onglet Historique de la personne : un administrateur qui
 * enquête doit voir exactement ce qu'elle voit, sinon les deux écrans se
 * contredisent au pire moment. La différence est le destinataire, pas le
 * contenu.
 *
 * Filtres : ?from=&to=&categories=&q=&limit=&skip=
 *
 * Ce que la route **ne** renvoie **pas** : le contenu des CV, des lettres et
 * des notes. La console annonce des volumes, pas la matière — c'est la ligne
 * déjà tenue par `overview`, et l'étendre ici en ferait une porte dérobée sur
 * les documents de chacun.
 */
export const userActivity = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

  const [historique, campagne, comptes] = await Promise.all([
    construireHistorique(user._id, {
      from: lireDate(req.query.from),
      to: lireDate(req.query.to),
      categories: lireCategories(req.query.categories),
      q: req.query.q || '',
      limit: req.query.limit,
      skip: req.query.skip,
    }),
    Campaign.findOne({ user: user._id }),
    PlatformAccount.find({ user: user._id }).select('platform sessionStatus lastLoginAt lastCheckedAt'),
  ]);

  res.json({
    user: {
      ...user.toPublic(),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
    },
    campagne: campagne
      ? {
          enabled: campagne.enabled,
          cron: campagne.cron,
          mode: campagne.mode,
          lastRunAt: campagne.lastRunAt,
          lastResult: campagne.lastResult,
          lastError: campagne.lastError,
        }
      : null,
    comptes: comptes.map((compte) => ({
      platform: compte.platform,
      sessionStatus: compte.sessionStatus,
      lastLoginAt: compte.lastLoginAt,
      lastCheckedAt: compte.lastCheckedAt,
    })),
    ...historique,
  });
});

/** PATCH /admin/users/:id — rôle et activation. */
export const updateUser = asyncHandler(async (req, res) => {
  const { role, active } = req.body || {};
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

  /*
   * On ne se retire pas soi-même les droits, et on ne désactive pas le dernier
   * administrateur : l'installation deviendrait ingérable, sans recours par
   * l'interface.
   */
  const seDegrade = String(user._id) === req.user.id && (role === 'user' || active === false);
  if (seDegrade) {
    return res.status(400).json({ error: 'Impossible de retirer ses propres droits.' });
  }

  if (user.role === 'admin' && (role === 'user' || active === false)) {
    const restants = await User.countDocuments({ role: 'admin', active: true, _id: { $ne: user._id } });
    if (restants === 0) {
      return res.status(400).json({ error: 'Il doit rester au moins un administrateur actif.' });
    }
  }

  if (role === 'user' || role === 'admin') user.role = role;
  if (typeof active === 'boolean') user.active = active;
  await user.save();

  // Désactiver quelqu'un doit arrêter ses campagnes sur-le-champ.
  await reschedule().catch(() => {});

  res.json({ user: user.toPublic() });
});

/**
 * DELETE /admin/users/:id — supprime le compte **et toutes ses données**.
 *
 * Sans ce nettoyage, les documents deviendraient orphelins : invisibles, mais
 * comptés dans les totaux et repris par le prochain administrateur créé.
 */
export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de supprimer son propre compte.' });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

  if (user.role === 'admin') {
    const restants = await User.countDocuments({ role: 'admin', _id: { $ne: user._id } });
    if (restants === 0) {
      return res.status(400).json({ error: 'Il doit rester au moins un administrateur.' });
    }
  }

  const owner = new mongoose.Types.ObjectId(req.params.id);
  const supprime = {};
  // Le journal d'activité part avec le reste : un compte supprimé ne doit pas
  // laisser derrière lui la trace de ce qu'il a fait.
  for (const Model of [JobOffer, Application, CVVersion, Campaign, PlatformAccount, ActivityEvent]) {
    const { deletedCount } = await Model.deleteMany({ user: owner });
    if (deletedCount) supprime[Model.modelName] = deletedCount;
  }
  await mongoose.model('Profile').deleteMany({ user: owner });
  await mongoose.model('SearchPreference').deleteMany({ user: owner });
  await user.deleteOne();

  await reschedule().catch(() => {});
  res.json({ deleted: user.email, documents: supprime });
});
