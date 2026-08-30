import Profile from '../models/Profile.js';
import { asyncHandler } from '../middleware.js';
import { composeCv, extractCv } from '../services/tailoringService.js';

// En dessous, le fichier déposé n'a rien donné d'exploitable (scan, PDF image…).
const MIN_CV_CHARS = 120;

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.forUser(req.user.id);
  res.json(profile);
});

export const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.forUser(req.user.id);
  Object.assign(profile, req.body);
  await profile.save();
  res.json(profile);
});

// POST /profile/cv — dépôt du CV (corps brut, nom du fichier dans X-Filename).
// Seul le texte extrait est conservé : le fichier n'est stocké nulle part.
export const uploadCv = asyncHandler(async (req, res) => {
  const raw = req.get('X-Filename') || '';
  let filename = 'cv';
  try {
    filename = decodeURIComponent(raw) || 'cv';
  } catch {
    filename = raw || 'cv'; // en-tête mal encodé : on garde tel quel
  }

  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }

  const result = await extractCv({ filename, buffer: req.body });

  if (!result.text || result.text.trim().length < MIN_CV_CHARS) {
    return res.status(422).json({
      error:
        "Aucun texte exploitable n'a pu être extrait de ce fichier. " +
        "S'il s'agit d'un scan, dépose une version texte (PDF exporté depuis Word, ou .docx).",
    });
  }

  const profile = await Profile.forUser(req.user.id);
  profile.masterCv = result.text;
  // Le document lui-même, pour l’aperçu et pour la candidature en mode classique.
  profile.cvFile = req.body;
  profile.cvMime = /.pdf$/i.test(filename) ? 'application/pdf' : 'application/octet-stream';
  profile.cvFileName = filename;
  profile.cvUploadedAt = new Date();
  profile.cvChars = result.chars || result.text.length;
  profile.cvPages = result.pages || 0;
  profile.cvWarnings = result.warnings || [];
  await profile.save();

  /*
   * Les rubriques reconnues repartent avec la réponse, **sans être écrites**.
   *
   * C’est l’interface qui demande confirmation avant de remplacer le profil :
   * un import écrase des heures de saisie, et le faire en silence serait une
   * perte de données déguisée en fonctionnalité. Le champ est donc une
   * proposition, pas un effet de bord.
   */
  res.status(201).json({ ...profile.toObject(), fields: result.fields || null });
});

// POST /profile/compose — construit le CV à partir des champs du formulaire
// et l'enregistre comme CV source.
export const composeProfileCv = asyncHandler(async (req, res) => {
  const profile = await Profile.forUser(req.user.id);

  // Le corps peut contenir des champs fraîchement saisis, pas encore enregistrés.
  if (req.body && Object.keys(req.body).length > 0) {
    const { _id, __v, createdAt, updatedAt, masterCv, ...fields } = req.body;
    Object.assign(profile, fields);
  }

  const { content } = await composeCv(profile.toObject());

  profile.masterCv = content;
  profile.cvFileName = '';
  profile.cvUploadedAt = new Date();
  profile.cvChars = content.length;
  profile.cvPages = 0;
  profile.cvWarnings = [];
  await profile.save();

  res.status(201).json(profile);
});

// DELETE /profile/cv — retire le CV déposé, garde le reste du profil.
export const deleteCv = asyncHandler(async (req, res) => {
  const profile = await Profile.forUser(req.user.id);
  profile.masterCv = '';
  profile.cvFileName = '';
  profile.cvUploadedAt = undefined;
  profile.cvChars = 0;
  profile.cvPages = 0;
  profile.cvWarnings = [];
  await profile.save();
  res.json(profile);
});

/**
 * GET /profile/cv-file — le CV importé, tel qu'il a été déposé.
 *
 * Sert l'aperçu de l'onglet « Mon CV » quand la personne a importé un document
 * plutôt que de saisir ses rubriques : c'est ce fichier qui sera joint aux
 * candidatures en mode classique, donc c'est lui qu'il faut montrer.
 */
export const getCvFile = asyncHandler(async (req, res) => {
  const profile = await Profile.forUser(req.user.id);
  const complet = await Profile.findById(profile._id).select('+cvFile');

  if (!complet?.cvFile?.length) {
    return res.status(404).json({ error: 'Aucun CV importé.' });
  }

  res.set({
    'Content-Type': complet.cvMime || 'application/pdf',
    'Content-Length': String(complet.cvFile.length),
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${
      (complet.cvFileName || 'cv').replace(/"/g, '')
    }"`,
  });
  res.end(complet.cvFile);
});
