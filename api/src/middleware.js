// Enrobe un contrôleur async pour router les rejets vers errorHandler
// sans try/catch répétitif.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Exige une session valide et pose `req.user`.
 *
 * Tout ce qui touche aux données d'une personne passe par là : c'est le seul
 * endroit où l'identité entre dans l'application, et les contrôleurs n'ont
 * ensuite qu'à filtrer sur `req.user.id`.
 */
export const requireAuth = asyncHandler(async (req, res, next) => {
  const { verify, COOKIE_NAME } = await import('./utils/session.js');
  const { default: User } = await import('./models/User.js');

  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Connexion requise.' });

  let payload;
  try {
    payload = verify(token);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }

  const user = await User.findById(payload.sub);
  if (!user) return res.status(401).json({ error: 'Compte introuvable.' });
  if (!user.active) return res.status(403).json({ error: 'Ce compte est désactivé.' });

  req.user = { id: user._id.toString(), role: user.role, email: user.email, doc: user };
  next();
});

/**
 * Réservé aux administrateurs.
 *
 * Le rôle est relu en base à chaque requête (via `requireAuth`), jamais pris
 * dans le jeton : rétrograder quelqu'un doit prendre effet immédiatement, sans
 * attendre l'expiration de sa session.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

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
    /*
     * Dire *sur quoi* porte le conflit.
     *
     * « Doublon détecté » seul ne distinguait pas un vrai doublon d'un index mal
     * cloisonné : la recherche d'offres d'un nouveau compte échouait sur une
     * unicité restée globale, et le message ne laissait rien deviner. Nommer les
     * champs en conflit rend la cause lisible sans ouvrir les logs.
     */
    const champs = Object.keys(err.keyValue || {});
    return res.status(409).json({
      error: champs.length
        ? `Doublon détecté sur ${champs.join(' + ')}`
        : 'Doublon détecté',
      keyValue: err.keyValue,
    });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
}
