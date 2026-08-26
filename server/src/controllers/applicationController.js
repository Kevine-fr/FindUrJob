import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import CVVersion from '../models/CVVersion.js';
import { asyncHandler } from '../middleware.js';
import { reconcilier } from '../services/reconciliation.js';
import { tailorCv } from '../services/tailoringService.js';
import { renderCvPdf } from '../services/botService.js';
import { buildTailoredCvHtml } from '../services/cvDocument.js';
import { buildLetterHtml } from '../services/letterDocument.js';
import { APPLICATION_STATUSES } from '../utils/constants.js';

const POPULATE = ['offer', 'cvVersion'];

export const listApplications = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = { user: req.user.id };
  if (status) filter.status = status;
  const applications = await Application.find(filter)
    .populate(POPULATE)
    .sort({ updatedAt: -1 });
  res.json(applications);
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
