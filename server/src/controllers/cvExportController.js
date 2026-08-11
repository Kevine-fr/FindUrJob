import { asyncHandler } from '../middleware.js';
import { renderCvPdf } from '../services/botService.js';

// Un document de CV avec photo intégrée reste sous le mégaoctet ; au-delà,
// c'est autre chose qu'un CV.
const MAX_HTML_BYTES = 4 * 1024 * 1024;

const slug = (value) =>
  String(value || 'cv')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'cv';

/**
 * POST /cv/pdf — { html, filename } → application/pdf
 *
 * Le document arrive tout fait du front : c'est lui qui possède le gabarit, et
 * l'aperçu affiché est donc littéralement ce qui part à l'impression. Le
 * serveur ne fait que relayer vers Chromium et remonter le résultat de
 * l'ajustement dans les en-têtes.
 */
export const exportCvPdf = asyncHandler(async (req, res) => {
  const { html, filename } = req.body || {};

  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ error: 'Document vide : rien à imprimer.' });
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return res.status(413).json({ error: 'Document trop lourd (photo trop grande ?).' });
  }

  const { buffer, fit } = await renderCvPdf(html);
  const name = `${slug(filename)}.pdf`;

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Content-Length': String(buffer.length),
    // Le front s'en sert pour dire ce que l'ajustement a coûté.
    'X-Cv-Density': String(fit.density),
    'X-Cv-Trimmed': String(fit.trimmed),
    'X-Cv-Overflow': String(fit.overflow),
    'X-Cv-Fill': String(fit.fill),
    'Access-Control-Expose-Headers': 'X-Cv-Density, X-Cv-Trimmed, X-Cv-Overflow, X-Cv-Fill',
  });
  res.end(buffer);
});
