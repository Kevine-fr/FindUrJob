import JobOffer from '../models/JobOffer.js';
import { asyncHandler } from '../middleware.js';

export const listOffers = asyncHandler(async (req, res) => {
  const { source, q } = req.query;
  const filter = {};
  if (source) filter.source = source;
  if (q) {
    filter.$or = [
      { title: new RegExp(q, 'i') },
      { company: new RegExp(q, 'i') },
      { description: new RegExp(q, 'i') },
    ];
  }
  const offers = await JobOffer.find(filter).sort({ createdAt: -1 });
  res.json(offers);
});

export const getOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findById(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.json(offer);
});

export const createOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.create(req.body);
  res.status(201).json(offer);
});

export const updateOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.json(offer);
});

export const deleteOffer = asyncHandler(async (req, res) => {
  const offer = await JobOffer.findByIdAndDelete(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offre introuvable' });
  res.status(204).end();
});
