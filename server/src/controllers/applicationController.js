import Application from '../models/Application.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import CVVersion from '../models/CVVersion.js';
import { asyncHandler } from '../middleware.js';
import { tailorCv } from '../services/tailoringService.js';
import { APPLICATION_STATUSES } from '../utils/constants.js';

const POPULATE = ['offer', 'cvVersion'];

export const listApplications = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const applications = await Application.find(filter)
    .populate(POPULATE)
    .sort({ updatedAt: -1 });
  res.json(applications);
});

export const getApplication = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).populate(POPULATE);
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  res.json(application);
});

export const createApplication = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findById(req.body.offer);
  if (!offer) return res.status(400).json({ error: 'Offre associée introuvable' });
  const application = await Application.create(req.body);
  res.status(201).json(await application.populate(POPULATE));
});

export const updateApplication = asyncHandler(async (req, res) => {
  // Le statut passe par l'endpoint dédié (pour journaliser la timeline).
  const { status, timeline, ...rest } = req.body;
  const application = await Application.findByIdAndUpdate(req.params.id, rest, {
    new: true,
    runValidators: true,
  }).populate(POPULATE);
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  res.json(application);
});

// PATCH /applications/:id/status — change le statut ET journalise la timeline.
export const updateStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  if (!APPLICATION_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Statut invalide : ${status}` });
  }
  const application = await Application.findById(req.params.id);
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });

  application.status = status;
  application.timeline.push({ status, note });
  if (status === 'postule' && !application.appliedAt) application.appliedAt = new Date();
  await application.save();
  res.json(await application.populate(POPULATE));
});

export const deleteApplication = asyncHandler(async (req, res) => {
  const application = await Application.findByIdAndDelete(req.params.id);
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });
  res.status(204).end();
});

// POST /applications/:id/tailor — génère un CV ciblé + lettre via le moteur IA.
export const tailorApplication = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).populate('offer');
  if (!application) return res.status(404).json({ error: 'Candidature introuvable' });

  const profile = await Profile.getSingleton();
  const result = await tailorCv({ offer: application.offer, profile });

  const at = application.offer.company ? ` @ ${application.offer.company}` : '';
  const cv = await CVVersion.create({
    label: `CV — ${application.offer.title}${at}`,
    kind: 'cible',
    offer: application.offer._id,
    content: result.content,
    score: typeof result.score === 'number' ? result.score : undefined,
  });

  application.cvVersion = cv._id;
  application.coverLetter = result.coverLetter;
  if (typeof result.score === 'number') application.matchScore = result.score;
  await application.save();

  res.status(201).json(await application.populate(POPULATE));
});
