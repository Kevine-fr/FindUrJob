import CVVersion from '../models/CVVersion.js';
import { asyncHandler } from '../middleware.js';

export const listCvVersions = asyncHandler(async (req, res) => {
  const { kind } = req.query;
  const filter = {};
  if (kind) filter.kind = kind;
  const cvs = await CVVersion.find(filter).populate('offer').sort({ createdAt: -1 });
  res.json(cvs);
});

export const getCvVersion = asyncHandler(async (req, res) => {
  const cv = await CVVersion.findById(req.params.id).populate('offer');
  if (!cv) return res.status(404).json({ error: 'CV introuvable' });
  res.json(cv);
});

export const createCvVersion = asyncHandler(async (req, res) => {
  const cv = await CVVersion.create(req.body);
  res.status(201).json(cv);
});

export const deleteCvVersion = asyncHandler(async (req, res) => {
  const cv = await CVVersion.findByIdAndDelete(req.params.id);
  if (!cv) return res.status(404).json({ error: 'CV introuvable' });
  res.status(204).end();
});
