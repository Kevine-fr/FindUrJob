import SearchPreference from '../models/SearchPreference.js';
import { asyncHandler } from '../middleware.js';

export const getPreferences = asyncHandler(async (req, res) => {
  res.json(await SearchPreference.forUser(req.user.id));
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const preference = await SearchPreference.forUser(req.user.id);
  Object.assign(preference, req.body);
  await preference.save();
  res.json(preference);
});
