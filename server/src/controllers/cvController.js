import CVVersion from '../models/CVVersion.js';
import { renderCvPdf } from '../services/botService.js';
import { buildTailoredCvHtml } from '../services/cvDocument.js';
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

/**
 * GET /cv-versions/:id/pdf — le CV en PDF.
 *
 * Sert d'abord le fichier **réellement envoyé**, conservé tel quel : c'est la
 * pièce que le recruteur a sous les yeux, et le profil a pu changer depuis.
 * Il n'est reconstruit que s'il n'a jamais été imprimé (candidature préparée
 * avant l'ajout du PDF, ou impression en échec ce jour-là).
 *
 * `?download=1` force le téléchargement plutôt que l'affichage.
 */
export const getCvVersionPdf = asyncHandler(async (req, res) => {
  const cv = await CVVersion.findById(req.params.id).select('+pdf');
  if (!cv) return res.status(404).json({ error: 'CV introuvable' });

  let pdf = cv.pdf?.length ? cv.pdf : null;

  if (!pdf) {
    if (!cv.content?.trim()) {
      return res.status(404).json({ error: 'Ce CV est vide : rien à imprimer.' });
    }
    const { buffer } = await renderCvPdf(buildTailoredCvHtml(cv.content));
    pdf = buffer;
    // On garde l'impression : la prochaine consultation sera immédiate, et
    // toutes montreront le même document.
    cv.pdf = buffer;
    cv.pdfBytes = buffer.length;
    await cv.save();
  }

  const nom = `${(cv.label || 'cv').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(pdf.length),
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${nom}"`,
  });
  res.end(pdf);
});
