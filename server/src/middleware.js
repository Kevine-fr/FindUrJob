// Enrobe un contrôleur async pour router les rejets vers errorHandler
// sans try/catch répétitif.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Traduction des erreurs Mongoose fréquentes en réponses claires.
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation échouée', details: err.errors });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Identifiant invalide : ${err.value}` });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Doublon détecté', keyValue: err.keyValue });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
}
