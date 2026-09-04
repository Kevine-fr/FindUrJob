import mongoose from 'mongoose';
import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import CVVersion from '../models/CVVersion.js';
import { asyncHandler } from '../middleware.js';
import { reconcilier, verifierUne } from '../services/reconciliation.js';
import { tailorCv } from '../services/tailoringService.js';
import { renderCvPdf } from '../services/botService.js';
import { buildTailoredCvHtml } from '../services/cvDocument.js';
import { buildLetterHtml } from '../services/letterDocument.js';
import { retenterCandidature } from '../services/applyRetry.js';
import { APPLICATION_STATUSES } from '../utils/constants.js';

const POPULATE = ['offer', 'cvVersion'];

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

// Unités acceptées pour l'ancienneté d'une annonce, en millisecondes.
const UNITES_MS = {
  minute: 60_000,
  heure: 3_600_000,
  jour: 86_400_000,
  semaine: 604_800_000,
  mois: 2_592_000_000,
};

// « C++ » ou « (H/F) » dans une recherche libre feraient tomber la requête.
const escapeRegex = (valeur) => valeur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /applications — liste paginée.
 *
 * Elle rendait **toutes** les candidatures d'un coup, chacune avec son offre et
 * sa version de CV jointes. À cinq cents candidatures, cela faisait plusieurs
 * mégaoctets à chaque affichage de l'onglet, et le rafraîchissement automatique
 * les redemandait toutes les vingt secondes.
 *
 * Le filtrage remonte ici en même temps que la pagination, et ce n'est pas un
 * détail : filtré côté navigateur, un statut ne se serait appliqué qu'à la page
 * affichée, et « Envoi échoué » n'aurait montré que les échecs des trente
 * dernières candidatures.
 *
 * Source, fraîcheur et concurrence appartiennent à l'*offre*, pas à la
 * candidature. On résout donc d'abord les offres concernées, puis on restreint
 * les candidatures à celles-là — une jointure suffirait, mais deux requêtes
 * indexées se lisent bien mieux qu'un pipeline d'agrégation.
 */
export const listApplications = asyncHandler(async (req, res) => {
  const user = req.user.id;
  const { status, source, q } = req.query;

  const filtreOffre = { user };
  let restreintParOffre = false;

  if (source) {
    filtreOffre.source = { $in: String(source).split(',').map((s) => s.trim()).filter(Boolean) };
    restreintParOffre = true;
  }

  const valeurAge = Number(req.query.publishedWithin);
  const uniteAge = UNITES_MS[req.query.publishedUnit] || UNITES_MS.jour;
  if (Number.isFinite(valeurAge) && valeurAge > 0) {
    // Sans date de publication, on ne peut pas affirmer qu'une annonce est
    // récente : elle sort du filtre plutôt que d'y passer pour fraîche.
    filtreOffre.publishedAt = { $ne: null, $gte: new Date(Date.now() - valeurAge * uniteAge) };
    restreintParOffre = true;
  }

  const maxCandidats = Number(req.query.maxApplicants);
  if (Number.isFinite(maxCandidats) && maxCandidats >= 0) {
    // Un compteur inconnu n'est pas un compteur à zéro.
    filtreOffre.applicantCount = { $ne: null, $lte: maxCandidats };
    restreintParOffre = true;
  }

  const filtre = { user };
  if (restreintParOffre) {
    filtre.offer = { $in: await JobOffer.find(filtreOffre).distinct('_id') };
  }

  /*
   * La recherche libre porte sur l'offre **et** sur les notes de la
   * candidature : c'est ce que faisait le filtrage côté navigateur, et le
   * restreindre à l'offre ferait disparaître des résultats sans prévenir.
   */
  if (q) {
    const motif = new RegExp(escapeRegex(q), 'i');
    const trouvees = await JobOffer.find({
      ...filtreOffre,
      $or: [{ title: motif }, { company: motif }, { location: motif }],
    }).distinct('_id');

    filtre.$and = [
      ...(filtre.$and || []),
      { $or: [{ offer: { $in: trouvees } }, { notes: motif }] },
    ];
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(Number(req.query.page) || 1, 1);

  // Le statut est appliqué à la page, mais **pas** aux compteurs : une pastille
  // doit annoncer combien il y a de « Postulé » même quand on regarde les
  // « Envoi échoué », sinon toutes les autres tomberaient à zéro dès le premier
  // clic.
  const filtrePage = status ? { ...filtre, status } : filtre;

  const [applications, total, meta] = await Promise.all([
    Application.find(filtrePage)
      .populate(POPULATE)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Application.countDocuments(filtrePage),
    Application.aggregate([
      { $match: { ...filtre, user: new mongoose.Types.ObjectId(user) } },
      { $lookup: { from: 'joboffers', localField: 'offer', foreignField: '_id', as: 'o' } },
      { $unwind: { path: '$o', preserveNullAndEmptyArrays: true } },
      {
        $facet: {
          parStatut: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          parSource: [{ $group: { _id: '$o.source', n: { $sum: 1 } } }],
        },
      },
    ]),
  ]);

  const compter = (lignes) =>
    Object.fromEntries((lignes || []).filter((l) => l._id).map((l) => [l._id, l.n]));

  res.json({
    applications,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
    // De quoi garder les pastilles justes alors qu'on ne voit qu'une page.
    counts: compter(meta?.[0]?.parStatut),
    sources: compter(meta?.[0]?.parSource),
  });
});

export const getApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOne({ _id: req.params.id, user: req.user.id }).populate(POPULATE);
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  res.json(application);
});

export const createApplication = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findOne({ _id: req.body.offer, user: req.user.id });
  if (!offer) return res.status(400).json({ error: 'Offre associée introuvable' });

  /*
   * Une offre déjà suivie ne se re-candidate pas.
   *
   * On renvoie la candidature existante plutôt qu'une erreur : suivre deux fois
   * la même annonce n'est pas une faute, c'est presque toujours un doublon de
   * clic. L'appelant retombe sur son dossier, et aucune seconde candidature
   * n'est créée.
   */
  const existante = await Application.findOne({ user: req.user.id, offer: offer._id });
  if (existante) {
    return res.status(200).json(await existante.populate(POPULATE));
  }

  const application = await Application.create({ ...req.body, user: req.user.id });
  res.status(201).json(await application.populate(POPULATE));
});

export const updateApplication = asyncHandler(async (req, res) => {
  // Le statut passe par l'endpoint dédié (pour journaliser la timeline).
  const { status, timeline, ...rest } = req.body;
  const application = await Application.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    rest,
    { new: true, runValidators: true }
  ).populate(POPULATE);
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  res.json(application);
});

// PATCH /applications/:id/status — change le statut ET journalise la timeline.
export const updateStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  if (!APPLICATION_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Statut invalide : ${status}` });
  }
  const application = await Application.findOne({ _id: req.params.id, user: req.user.id });
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });

  application.status = status;
  application.timeline.push({ status, note });
  if (status === 'postule' && !application.appliedAt) application.appliedAt = new Date();
  await application.save();
  res.json(await application.populate(POPULATE));
});

export const deleteApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  res.status(204).end();
});

// POST /applications/:id/tailor — génère un CV ciblé + lettre via le moteur IA.
export const tailorApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOne({ _id: req.params.id, user: req.user.id }).populate('offer');
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });

  const profile = await Profile.forUser(req.user.id);
  const result = await tailorCv({ offer: application.offer, profile });

  const at = application.offer.company ? ` @ ${application.offer.company}` : '';
  const cv = await CVVersion.create({
    user: req.user.id,
    label: `CV — ${application.offer.title}${at}`,
    kind: 'cible',
    offer: application.offer._id,
    content: result.content,
    score: typeof result.score === 'number' ? result.score : undefined,
  });

  // Le PDF est produit tout de suite : c'est lui qu'on relira et qu'on joindra
  // à la candidature. L'échec d'impression ne doit pas perdre le CV texte.
  try {
    const { buffer } = await renderCvPdf(
      buildTailoredCvHtml(result.content, { accent: profile.cvOptions?.accent })
    );
    cv.pdf = buffer;
    cv.pdfBytes = buffer.length;
    await cv.save();
  } catch {
    /* le CV reste consultable en texte ; le PDF sera tenté à la demande */
  }

  application.cvVersion = cv._id;
  application.coverLetter = result.coverLetter;
  if (typeof result.score === 'number') application.matchScore = result.score;
  await application.save();

  res.status(201).json(await application.populate(POPULATE));
});

/**
 * GET /applications/:id/letter.pdf — la lettre telle qu'elle part.
 *
 * Rendue à la demande plutôt que stockée : elle est courte, l'impression prend
 * moins d'une seconde, et une lettre corrigée ne doit pas rester figée sur une
 * version périmée comme le serait un PDF conservé en base.
 */
export const getLetterPdf = asyncHandler(async (req, res) => {
  const application = await Application.findOne({
    _id: req.params.id,
    user: req.user.id,
  }).populate('offer');

  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  if (!application.coverLetter?.trim()) {
    return res.status(404).json({ error: "Aucune lettre sur cette candidature." });
  }

  const { buffer } = await renderCvPdf(
    buildLetterHtml(application.coverLetter, { offre: application.offer?.title })
  );

  const nom = `lettre-${(application.offer?.title || 'candidature')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()}.pdf`;

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(buffer.length),
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${nom}"`,
  });
  res.end(buffer);
});

/**
 * POST /applications/reconcile — demander aux plateformes ce qu'elles ont reçu.
 *
 * Le robot ne marque « Postulé » que s'il voit une confirmation, et une
 * confirmation ne s'affiche pas toujours. Cette passe va lire la liste que
 * chaque plateforme tient de son côté et promeut ce qu'elle reconnaît. Elle ne
 * dégrade jamais un statut : une absence de la liste ne prouve rien.
 */
export const reconcileApplications = asyncHandler(async (req, res) => {
  const bilan = await reconcilier(req.user.id, {
    sources: Array.isArray(req.body?.sources) ? req.body.sources : null,
    max: Math.min(400, Math.max(20, Number(req.body?.max) || 200)),
  });
  res.json(bilan);
});

/**
 * POST /applications/:id/verify — cette candidature est-elle déjà partie ?
 *
 * La passe complète existait déjà, mais elle se lance depuis la liste et
 * parcourt tout. Depuis une fiche « à vérifier », la seule action possible
 * était de relancer, c'est-à-dire de risquer le doublon sans savoir. Ce
 * bouton pose la question à la plateforme, pour cette candidature-là.
 *
 * Le service porte les verdicts, y compris « impossible » : une plateforme
 * qui ne tient pas de liste n'est pas une erreur, c'est une réponse.
 */
export const verifyApplication = asyncHandler(async (req, res) => {
  res.json(await verifierUne(req.user.id, req.params.id));
});

/**
 * POST /applications/:id/retry — relancer un envoi qui n'a pas abouti.
 *
 * Le service porte toutes les gardes : statut recevable, cause encore
 * retentable, plafond de reprises, et surtout la vérification anti-doublon sur
 * « à vérifier ». Le contrôleur ne fait que traduire son refus en réponse HTTP.
 *
 * `force` vient d'un geste explicite de la personne, jamais d'un réglage : il
 * signifie « j'ai vérifié sur la plateforme, rien n'est arrivé ».
 */
export const retryApplication = asyncHandler(async (req, res) => {
  try {
    const bilan = await retenterCandidature(req.user.id, req.params.id, {
      force: Boolean(req.body?.force),
    });
    res.json(bilan);
  } catch (erreur) {
    if (!erreur.status) throw erreur;
    res.status(erreur.status).json({
      error: erreur.message,
      reason: erreur.reason || null,
      action: erreur.action || null,
      needsConfirmation: Boolean(erreur.needsConfirmation),
    });
  }
});

/**
 * GET /applications/:id/screenshot — l'écran au moment du blocage.
 *
 * Servi comme une image, pas encodé dans le JSON de la candidature : une page
 * de liste chargerait alors des centaines de kilo-octets que personne ne
 * regarde. Ici, l'image n'est demandée que lorsqu'on ouvre la fiche.
 */
export const getFailureShot = asyncHandler(async (req, res) => {
  /*
   * Pas de `.lean()` ici, et ce n'est pas un détail.
   *
   * Un champ Buffer relu en `lean` revient tel que le pilote le rend — un
   * `Binary`, dont `.length` est une *fonction*. Le garde-fou la trouvait donc
   * toujours vraie, l'en-tête `Content-Length` valait le texte d'une fonction,
   * et l'image ne pouvait pas s'afficher. Mongoose, lui, rend un vrai Buffer.
   */
  const application = await Application.findOne({ _id: req.params.id, user: req.user.id }).select(
    '+failureShot failureShotAt'
  );

  if (!application) return res.status(404).json({ error: 'Candidature introuvable.' });
  if (!application.failureShot?.length) {
    return res.status(404).json({ error: 'Aucune capture pour cette candidature.' });
  }

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': String(application.failureShot.length),
    // La capture ne change qu'à la prochaine tentative : inutile de la
    // retélécharger à chaque ouverture de la fiche.
    'Cache-Control': 'private, max-age=300',
    'Content-Disposition': 'inline; filename="blocage.png"',
  });
  res.end(application.failureShot);
});
