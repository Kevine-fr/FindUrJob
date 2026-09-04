import cron from 'node-cron';
import Upkeep from '../models/Upkeep.js';
import { asyncHandler } from '../middleware.js';
import { relancerLot, verifierAupresDesPlateformes, relancables } from '../services/upkeep.js';
import { rescheduleUpkeep } from '../scheduler.js';

/**
 * L'entretien des candidatures : relance en lot et vérification.
 *
 * Les deux se **lancent** ici et se poursuivent en fond. Le contrôleur rend un
 * accusé de réception, pas un résultat : la vérification ouvre un navigateur
 * par plateforme et la relance un par candidature, soit plusieurs minutes que
 * ni le navigateur ni le serveur mandataire ne laisseraient passer.
 *
 * L'avancement se relit sur `GET /upkeep`. C'est le même contrat que la
 * campagne : un drapeau `running`, une étape, un dernier bilan.
 */

/** Ce qui part au client : l'état, sans rien de sensible. */
const vue = (doc, aRelancer) => ({
  retry: doc.retry,
  verify: doc.verify,
  retryMax: doc.retryMax,
  // Combien de candidatures une relance reprendrait maintenant : sans ce
  // chiffre, le bouton ne dit pas s'il y a quelque chose à faire.
  relancables: aRelancer,
});

/** GET /upkeep — état des deux travaux, relu pendant qu'ils tournent. */
export const getUpkeep = asyncHandler(async (req, res) => {
  const doc = await Upkeep.forUser(req.user.id);
  const liste = await relancables(req.user.id, { max: 100 });
  res.json(vue(doc, liste.length));
});

/** PUT /upkeep — automatisation : rythme, plafond, activation. */
export const updateUpkeep = asyncHandler(async (req, res) => {
  const doc = await Upkeep.forUser(req.user.id);
  const { retry, verify, retryMax } = req.body || {};

  for (const [quoi, valeurs] of [['retry', retry], ['verify', verify]]) {
    if (!valeurs) continue;
    if (typeof valeurs.enabled === 'boolean') doc[quoi].enabled = valeurs.enabled;
    if (typeof valeurs.cron === 'string') {
      // Une expression invalide est refusée ici plutôt qu'ignorée plus tard :
      // sinon l'automatisation paraît active et ne se déclenche jamais.
      if (!cron.validate(valeurs.cron)) {
        return res.status(400).json({ error: `Rythme invalide : « ${valeurs.cron} ».` });
      }
      doc[quoi].cron = valeurs.cron;
    }
  }
  if (retryMax != null) doc.retryMax = Math.min(100, Math.max(1, Number(retryMax) || 10));

  await doc.save();
  // Le planificateur relit tout de suite : sans cela, un changement de rythme
  // n'aurait d'effet qu'au prochain redémarrage.
  await rescheduleUpkeep().catch(() => {});

  const liste = await relancables(req.user.id, { max: 100 });
  res.json(vue(doc, liste.length));
});

/**
 * Démarre un travail sans l'attendre.
 *
 * L'erreur éventuelle n'a personne à qui être rendue — la réponse est déjà
 * partie : elle est écrite dans le bilan du document, que la page relit.
 */
const demarrer = (travail, quoi) =>
  asyncHandler(async (req, res) => {
    const doc = await Upkeep.forUser(req.user.id);
    if (doc[quoi]?.running) {
      return res.status(409).json({ error: 'Ce travail est déjà en cours.', ...vue(doc, 0) });
    }

    travail(req.user.id, req.body || {}).catch((erreur) =>
      console.error(`entretien ${quoi} :`, erreur?.message)
    );

    res.status(202).json({ started: true });
  });

/** POST /upkeep/retry — relancer les candidatures qui n'ont pas abouti. */
export const startRetry = demarrer(
  (user, body) => relancerLot(user, { max: body.max }),
  'retry'
);

/** POST /upkeep/verify — demander aux plateformes ce qu'elles ont reçu. */
export const startVerify = demarrer(
  (user, body) =>
    verifierAupresDesPlateformes(user, {
      sources: Array.isArray(body.sources) ? body.sources : null,
      max: Math.min(400, Math.max(20, Number(body.max) || 200)),
    }),
  'verify'
);
