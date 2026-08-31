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

  /*
   * Les rubriques reconnues sont **gardées sans être appliquées**.
   *
   * C'est l'interface qui décide, et seulement sur un geste explicite : un
   * import écrase des heures de saisie, et le faire en silence serait une perte
   * de données déguisée en fonctionnalité.
   *
   * Elles sont enregistrées, et non plus seulement renvoyées : la proposition
   * survit ainsi au rechargement de la page, et les rubriques peuvent être
   * remplies plus tard — après avoir d'abord voulu garder le document tel quel,
   * par exemple — sans avoir à redéposer le fichier.
   */
  profile.cvFields = result.fields || null;
  profile.cvParseMethod = result.parseMethod || '';

  // Ce qu'on vient de déposer est ce qu'on s'attend à voir : l'aperçu bascule
  // sur le document importé. Un bouton suffit à revenir au CV composé.
  profile.cvMode = 'importe';
  await profile.save();

  res.status(201).json({ ...profile.toObject(), fields: result.fields || null });
});

/**
 * POST /profile/cv/fields — remplit les rubriques depuis le dernier import.
 *
 * Séparé du dépôt, et c'est tout l'intérêt : importer un CV et en reprendre les
 * données sont deux gestes distincts. On peut vouloir le document tel quel et
 * changer d'avis, ou remplir les rubriques sans jamais afficher le fichier.
 *
 * Le remplacement est franc : on ne fusionne pas. Mélanger deux CV produit des
 * doublons que personne ne relit.
 */
export const applyCvFields = asyncHandler(async (req, res) => {
  const base = await Profile.forUser(req.user.id);
  const profile = await Profile.findById(base._id).select('+cvFields');

  const champs = profile.cvFields;
  if (!champs || typeof champs !== 'object') {
    return res.status(409).json({
      error:
        "Aucune rubrique n'a été reconnue dans le dernier CV importé. " +
        'Dépose un fichier texte (PDF exporté depuis Word, ou .docx) plutôt qu’un scan.',
    });
  }

  // Seules les clés que le profil connaît : le reste serait du bruit persistant.
  const AUTORISES = [
    'fullName', 'headline', 'email', 'phone', 'location', 'summary',
    'skillGroups', 'experiences', 'education', 'projects', 'languages', 'interests',
  ];
  for (const cle of AUTORISES) {
    if (champs[cle] !== undefined) profile[cle] = champs[cle];
  }

  // Les rubriques viennent d'être remplies : c'est le CV composé qui fait foi.
  profile.cvMode = 'compose';
  await profile.save();

  res.json(profile.toObject());
});

/**
 * PUT /profile/cv-mode — choisit lequel des deux CV fait foi.
 * Body : { mode: 'compose' | 'importe' }
 */
export const setCvMode = asyncHandler(async (req, res) => {
  const mode = req.body?.mode;
  if (!['compose', 'importe'].includes(mode)) {
    return res.status(400).json({ error: "Mode attendu : « compose » ou « importe »." });
  }

  const profile = await Profile.forUser(req.user.id);
  if (mode === 'importe') {
    const complet = await Profile.findById(profile._id).select('+cvFile');
    if (!complet?.cvFile?.length) {
      return res.status(409).json({ error: 'Aucun CV importé à afficher.' });
    }
  }

  profile.cvMode = mode;
  await profile.save();
  res.json(profile.toObject());
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

  /*
   * Les octets partent aussi.
   *
   * Seules les métadonnées étaient effacées : l'écran annonçait « CV retiré »
   * pendant que le fichier restait en base, toujours joignable par la campagne.
   * Un document qu'on croit supprimé ne doit pas pouvoir arriver chez un
   * recruteur.
   */
  profile.cvFile = undefined;
  profile.cvMime = '';
  profile.cvFields = null;
  profile.cvParseMethod = '';
  profile.cvMode = 'compose';
  await profile.save();
  res.json(profile.toObject());
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
