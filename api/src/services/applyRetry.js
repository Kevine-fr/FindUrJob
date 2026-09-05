import Application from '../models/Application.js';
import CVVersion from '../models/CVVersion.js';
import JobOffer from '../models/JobOffer.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import PlatformQuestion from '../models/PlatformQuestion.js';
import { botApply, botConfigured, renderCvPdf } from './botService.js';
import { buildTailoredCvHtml } from './cvDocument.js';
import { tryRevive } from './sessionRevival.js';
import { reconcilier, AVEC_LISTE } from './reconciliation.js';
import { appliquerResultat } from './applyOutcome.js';
import { enregistrerQuestions, reponsesPour } from './applyKnowledge.js';
import { journaliser } from './activityLog.js';
import { infoEchec } from '../utils/applyFailure.js';

/**
 * Relancer une candidature qui n'est pas partie.
 *
 * Deux situations, et elles ne se traitent pas pareil :
 *
 *   « échec d'envoi »  — on sait que rien n'est parti. Relancer est sans
 *                        risque dès lors que la cause peut avoir changé : une
 *                        information manquante désormais fournie, une session
 *                        rouverte, un incident réseau passé.
 *
 *   « à vérifier »     — on ne sait pas. Le bouton a été actionné sans
 *                        confirmation : la candidature est peut-être arrivée.
 *                        Relancer à l'aveugle, c'est risquer le double envoi —
 *                        exactement ce que ce statut existe pour éviter.
 *
 * D'où la règle : sur « à vérifier », on demande d'abord à la plateforme. Si
 * elle tient une liste lisible, le rapprochement tranche. Sinon, seule une
 * confirmation explicite de la personne autorise la relance.
 */

/** Au-delà, insister ne ressemble plus à une reprise mais à de l'acharnement. */
const MAX_REPRISES = 5;

/*
 * Plateformes dont on sait relire la liste de candidatures envoyées.
 *
 * Cette liste était recopiée ici, et elle avait divergé : le rapprochement
 * sait lire France Travail et Welcome to the Jungle depuis qu'on a trouvé
 * leurs pages, mais la relance continuait de répondre « impossible de
 * vérifier » et de réclamer une confirmation manuelle pour ces deux-là. On
 * lit la source unique plutôt que d'en tenir une copie.
 */

class RefusReprise extends Error {
  constructor(message, code = 400, extra = {}) {
    super(message);
    this.status = code;
    Object.assign(this, extra);
  }
}

/**
 * Le PDF à joindre.
 *
 * On réutilise celui déjà imprimé pour cette offre : il a été reciblé au moment
 * de la préparation, et le réimprimer coûterait un appel au modèle pour un
 * document identique. Le repli sur le CV de référence couvre les candidatures
 * anciennes, dont le PDF n'avait pas été conservé.
 */
async function pdfPour(application, profile) {
  const version = application.cvVersion
    ? await CVVersion.findById(application.cvVersion).select('+pdf content')
    : null;

  if (version?.pdf?.length) return version.pdf;

  if (version?.content) {
    const { buffer } = await renderCvPdf(
      buildTailoredCvHtml(version.content, { accent: profile?.cvOptions?.accent })
    );
    return buffer;
  }

  if (profile?.masterCvHtml) {
    const { buffer } = await renderCvPdf(profile.masterCvHtml);
    return buffer;
  }
  if (profile?.cvFile?.length) return profile.cvFile;

  throw new RefusReprise(
    "Aucun CV disponible pour cette candidature : ouvre « Mon CV » et enregistre une fois.",
    422
  );
}

export async function retenterCandidature(user, applicationId, { force = false } = {}) {
  if (!botConfigured()) {
    throw new RefusReprise('Navigateur piloté non configuré : la relance est impossible.', 503);
  }

  const application = await Application.findOne({ _id: applicationId, user }).populate('offer');
  if (!application) throw new RefusReprise('Candidature introuvable.', 404);

  const offer = application.offer;
  if (!offer) {
    throw new RefusReprise("L'annonce a été supprimée : il n'y a plus rien où candidater.", 410);
  }
  if (!offer.sourceUrl) {
    throw new RefusReprise("Cette annonce n'a pas d'adresse : impossible de candidater.", 422);
  }

  if (!['echec_envoi', 'a_verifier'].includes(application.status)) {
    throw new RefusReprise(
      `Seules les candidatures en « échec d'envoi » ou « à vérifier » se relancent — celle-ci est « ${application.status} ».`,
      409
    );
  }

  if (application.retryCount >= MAX_REPRISES) {
    throw new RefusReprise(
      `Déjà ${application.retryCount} relances : la cause ne se règle visiblement pas toute seule. À finir à la main.`,
      429
    );
  }

  /*
   * Une cause non retentable ne le devient pas parce qu'on insiste : un
   * captcha opposera le même mur, et une annonce qui renvoie vers l'outil du
   * recruteur n'a rien à recevoir ici. On le dit plutôt que de faire semblant.
   */
  const cause = infoEchec(application.lastFailure?.reason);

  /*
   * Une cause réparable cesse de l'être une fois qu'on l'a réparée.
   *
   * `post_envoi_incomplet` — le questionnaire qui suit l'envoi — est marqué non
   * retentable, et à juste titre tant qu'il manque une réponse : réessayer
   * buterait sur la même question. Mais dès que la personne l'a renseignée dans
   * l'onglet Informations, la cause a disparu, et refuser la relance enferme
   * dans une boucle : le message revient à l'identique, sans qu'aucun geste ne
   * puisse en sortir. C'est exactement ce que la relance existe pour éviter.
   *
   * On regarde donc si les champs qui bloquaient ont désormais une réponse. Le
   * rapprochement se fait sur la clé normalisée, la même que celle sous
   * laquelle la question a été posée.
   */
  const bloquants = application.lastFailure?.fields || [];
  let reparee = false;
  if (bloquants.length) {
    const repondues = await PlatformQuestion.countDocuments({
      user,
      cle: { $in: bloquants.map((c) => c.cle).filter(Boolean) },
      statut: 'repondue',
      reponse: { $ne: '' },
    });
    reparee = repondues >= bloquants.filter((c) => c.cle).length;
  }

  if (application.lastFailure?.reason && !cause.retentable && !reparee && !force) {
    throw new RefusReprise(
      `${cause.label} : relancer ne changera rien. ${cause.action}`,
      409,
      { reason: application.lastFailure.reason, action: cause.action }
    );
  }

  /*
   * « À vérifier » : on cherche la preuve avant de risquer un doublon.
   *
   * Le rapprochement ne sait lire que les plateformes qui exposent une liste.
   * Ailleurs, aucune preuve n'est accessible — et c'est précisément pourquoi la
   * relance y demande un accord explicite au lieu de se décider seule.
   */
  if (application.status === 'a_verifier' && !force) {
    if (!AVEC_LISTE.includes(offer.source)) {
      throw new RefusReprise(
        `Impossible de vérifier auprès de ${offer.source} si la candidature est déjà partie. ` +
          'Vérifie sur la plateforme, puis confirme la relance si rien n’est arrivé.',
        409,
        { needsConfirmation: true }
      );
    }

    await reconcilier(user, { sources: [offer.source] }).catch(() => null);
    const relu = await Application.findById(application._id).select('status');
    if (relu?.status === 'postule') {
      throw new RefusReprise(
        'La plateforme confirme avoir reçu cette candidature : elle est passée en « postulé », rien à relancer.',
        409
      );
    }
  }

  const [profile, compte, reponses] = await Promise.all([
    Profile.findOne({ user }).select('+cvFile +masterCvHtml'),
    User.findById(user).select('fullName email'),
    reponsesPour(user, offer.source).catch(() => ({})),
  ]);

  const cvPdf = await pdfPour(application, profile);

  const identite = {
    firstName: (profile?.fullName || compte?.fullName || '').split(' ')[0] || '',
    lastName: (profile?.fullName || compte?.fullName || '').split(' ').slice(1).join(' ') || '',
    email: profile?.email || compte?.email || '',
    phone: profile?.phone || '',
    // Même identité que la campagne, ville comprise : une relance qui remplirait
    // moins de champs que l'envoi initial échouerait pour une raison de plus.
    city: profile?.location || '',
  };

  const envoyer = () =>
    botApply(
      offer.source,
      offer,
      {
        filename: `CV-${(profile?.fullName || 'candidat').replace(/\s+/g, '-')}.pdf`,
        content: cvPdf.toString('base64'),
      },
      user,
      { applicant: identite, coverLetter: application.coverLetter || '', dryRun: false, answers: reponses }
    );

  // Session fermée : on la rouvre une fois, comme le fait la campagne.
  let outcome;
  try {
    outcome = await envoyer();
  } catch (erreur) {
    if (erreur.status !== 409 || !(await tryRevive(offer.source, user))) {
      application.retryCount += 1;
      application.lastRetryAt = new Date();
      application.timeline.push({ status: application.status, note: `Relance impossible : ${erreur.message}` });
      await application.save();
      throw new RefusReprise(erreur.message, erreur.status || 502);
    }
    outcome = await envoyer();
  }

  const bilan = appliquerResultat(application, outcome, {
    platform: offer.source,
    note: 'Relancée à la main, CV joint.',
  });

  application.retryCount += 1;
  application.lastRetryAt = new Date();
  await application.save();

  if (bilan.offerPatch) {
    await JobOffer.updateOne({ _id: offer._id }, { $set: bilan.offerPatch }).catch(() => {});
  }
  await enregistrerQuestions(bilan.questions, { user, platform: offer.source, offer: offer._id });

  if (bilan.categorie === 'sent' && application.cvVersion) {
    await CVVersion.updateOne({ _id: application.cvVersion }, { $set: { sentAt: new Date() } }).catch(
      () => {}
    );
  }

  await journaliser(user, 'campagne.execution', {
    severity: bilan.categorie === 'sent' ? 'succes' : 'avertissement',
    summary: `Relance ${offer.source} — ${outcome.message || bilan.categorie}`,
    detail: { reprise: application.retryCount, resultat: bilan.categorie },
    application: application._id,
    offer: offer._id,
  });

  return {
    categorie: bilan.categorie,
    status: application.status,
    message: outcome.message || '',
    reason: application.lastFailure?.reason || null,
    retryCount: application.retryCount,
  };
}
