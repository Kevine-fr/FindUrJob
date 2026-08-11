import SearchPreference from '../models/SearchPreference.js';
import { asyncHandler } from '../middleware.js';

export const getPreferences = asyncHandler(async (req, res) => {
  res.json(await SearchPreference.getSingleton());
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const preference = await SearchPreference.getSingleton();
  Object.assign(preference, req.body);
  await preference.save();
  res.json(preference);
});
