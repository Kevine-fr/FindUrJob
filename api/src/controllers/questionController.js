import PlatformQuestion from '../models/PlatformQuestion.js';
import Application from '../models/Application.js';
import { asyncHandler } from '../middleware.js';
import { bilanEchecs } from '../services/applyKnowledge.js';
import { RAISONS_ECHEC } from '../utils/applyFailure.js';

/**
 * Les informations que les plateformes réclament, et ce qui bloque.
 *
 * C'est l'écran qui referme la boucle : chaque échec réparable y pose une
 * question, chaque réponse retire cette cause pour toutes les candidatures
 * suivantes. Le reste — captcha, redirection vers l'outil du recruteur — y
 * figure aussi, mais dans le diagnostic : ce sont des murs, pas des questions.
 */

/** GET /questions — ce qui attend une réponse, et le bilan des blocages. */
export const listQuestions = asyncHandler(async (req, res) => {
  const depuis = req.query.days
    ? new Date(Date.now() - Math.min(Number(req.query.days) || 30, 365) * 86_400_000)
    : null;

  const [questions, blocages, enAttente] = await Promise.all([
    PlatformQuestion.find({ user: req.user.id })
      .populate('exempleOffre', 'title company')
      // Les plus coûteuses d'abord : répondre à celle qui a bloqué douze
      // candidatures vaut mieux que de commencer par celle vue une fois.
      .sort({ statut: 1, rencontres: -1, dernierVuLe: -1 })
      .limit(200)
      .lean(),
    bilanEchecs(Application, req.user.id, { depuis }),
    PlatformQuestion.countDocuments({ user: req.user.id, statut: 'en_attente' }),
  ]);

  res.json({
    questions,
    blocages,
    enAttente,
    // La table des causes voyage avec la réponse : l'interface n'a pas à en
    // tenir une copie qui se désynchroniserait au premier ajout.
    raisons: RAISONS_ECHEC,
  });
});

/**
 * PATCH /questions/:id — répondre, ou écarter.
 *
 * Écarter est un choix légitime : certaines questions ne concernent pas la
 * personne, et les remontrer à chaque échec serait du harcèlement. Une question
 * écartée reste comptée dans le diagnostic — elle bloque toujours — mais ne
 * réclame plus rien.
 */
export const answerQuestion = asyncHandler(async (req, res) => {
  const { reponse, statut } = req.body || {};

  const question = await PlatformQuestion.findOne({ _id: req.params.id, user: req.user.id });
  if (!question) return res.status(404).json({ error: 'Question introuvable.' });

  if (statut === 'ignoree') {
    question.statut = 'ignoree';
    question.reponse = '';
  } else if (typeof reponse === 'string') {
    const valeur = reponse.trim();
    question.reponse = valeur;
    // Vider une réponse la remet en attente : c'est le seul moyen de revenir
    // sur une réponse jugée mauvaise sans supprimer la question.
    question.statut = valeur ? 'repondue' : 'en_attente';
  } else {
    return res.status(400).json({ error: 'Rien à enregistrer.' });
  }

  await question.save();

  /*
   * Une réponse vaut pour toutes les plateformes qui posent la même question.
   *
   * Les questions sont stockées par plateforme — c'est ce qui permet de savoir
   * laquelle réclame quoi. Mais « Années d'expérience » a la même réponse chez
   * France Travail, à l'APEC et sur LinkedIn : la demander trois fois n'apporte
   * rien et fait traîner trois fois plus longtemps la couverture des
   * formulaires. Mesuré avant correction : répondre pour France Travail
   * laissait l'APEC sans réponse.
   *
   * La clé normalisée est ce qui autorise ce rapprochement : c'est exactement
   * ce pour quoi elle existe.
   */
  const propagation = await PlatformQuestion.updateMany(
    {
      user: req.user.id,
      cle: question.cle,
      _id: { $ne: question._id },
      // On ne réécrit jamais une réponse déjà donnée à la main, ni une question
      // délibérément ignorée : ce serait défaire un choix.
      statut: 'en_attente',
    },
    { $set: { reponse: question.reponse, statut: question.statut, repondueLe: new Date() } }
  );

  res.json({ question, propagees: propagation.modifiedCount });
});

/** DELETE /questions/:id — oublier une question devenue sans objet. */
export const deleteQuestion = asyncHandler(async (req, res) => {
  const { deletedCount } = await PlatformQuestion.deleteOne({
    _id: req.params.id,
    user: req.user.id,
  });
  if (!deletedCount) return res.status(404).json({ error: 'Question introuvable.' });
  res.status(204).end();
});
