import Profile from '../models/Profile.js';
import { asyncHandler } from '../middleware.js';

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.getSingleton();
  res.json(profile);
});

export const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.getSingleton();
  Object.assign(profile, req.body);
  await profile.save();
  res.json(profile);
});
