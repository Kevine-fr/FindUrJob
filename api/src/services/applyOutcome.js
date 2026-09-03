import { deviner } from '../utils/applyFailure.js';

/**
 * Traduire ce que le robot a rendu en état de candidature.
 *
 * Cette fonction est **pure** et synchrone : elle modifie la candidature qu'on
 * lui passe et rend ce qu'il reste à faire, sans toucher à la base. C'est
 * délibéré — c'est la pièce qui décide si une candidature compte comme partie,
 * et se tromper ici produit soit un double envoi, soit une candidature perdue
 * qu'on croit envoyée. On veut pouvoir l'éprouver sans base ni robot.
 *
 * Elle est partagée par la campagne et par la reprise manuelle. Les deux
 * chemins doivent qualifier un résultat exactement pareil : deux copies de
 * cette logique auraient fini par diverger, et la divergence porterait
 * précisément sur « est-ce parti ou non ».
 *
 * @returns { categorie, offerPatch, questions }
 *   `categorie`  — 'sent' | 'ready' | 'uncertain' | 'failed'
 *   `offerPatch` — ce qu'il faut écrire sur l'offre, ou null
 *   `questions`  — les champs à verser dans la base de connaissances
 */
export function appliquerResultat(application, outcome = {}, { platform = '', note = '' } = {}) {
  const message = outcome.message || '';
  const champs = (outcome.fields || []).map((champ) => ({
    cle: champ.cle,
    libelle: champ.libelle,
    forme: champ.forme || 'texte',
    options: champ.options || [],
  }));

  /** Range la cause sur la candidature, sous une forme comptable. */
  const marquerEchec = (codeParDefaut) => {
    application.lastFailure = {
      reason: outcome.reason || deviner(message) || codeParDefaut,
      message,
      platform,
      at: new Date(),
      fields: champs.map(({ cle, libelle, forme }) => ({ cle, libelle, forme })),
    };
  };

  if (outcome.status === 'sent') {
    application.status = 'postule';
    application.appliedAt = new Date();
    application.timeline.push({
      status: 'postule',
      note: note || 'Envoyée, CV reciblé joint.',
    });
    /*
     * L'envoi a réussi : le diagnostic précédent ne vaut plus. Le laisser
     * ferait remonter une candidature partie dans la liste de ce qui reste à
     * réparer — et inviterait à la renvoyer.
     */
    application.lastFailure = undefined;
    return { categorie: 'sent', offerPatch: null, questions: [] };
  }

  if (outcome.status === 'dry-run') {
    // Essai : le formulaire était prêt à partir, on n'a pas appuyé. Rien n'est
    // daté, la candidature reste à postuler.
    application.timeline.push({
      status: 'a_postuler',
      note: `Essai concluant : ${message || 'formulaire prêt.'}`,
    });
    return { categorie: 'ready', offerPatch: null, questions: [] };
  }

  if (outcome.status === 'uncertain') {
    /*
     * Le bouton a été actionné, la plateforme n'a rien confirmé.
     *
     * Ni « postulé » — ce serait affirmer sans preuve — ni « échec » : la
     * candidature est peut-être arrivée, et c'est précisément le cas qui a
     * produit un double envoi. On le nomme pour ce qu'il est, et personne n'y
     * retouche automatiquement.
     */
    application.status = 'a_verifier';
    application.notes = `${application.notes || ''} — à vérifier : ${message}`;
    application.timeline.push({ status: 'a_verifier', note: message || 'Issue inconnue.' });
    marquerEchec('sans_confirmation');
    // Le questionnaire resté incomplet dit quand même ce qu'il faudra savoir.
    return { categorie: 'uncertain', offerPatch: null, questions: champs };
  }

  if (outcome.status === 'external' || outcome.status === 'blocked') {
    /*
     * Rien n'a échoué : il n'y avait rien à envoyer ici. La leçon s'écrit sur
     * l'offre pour qu'aucune passe suivante n'y regoûte, et l'adresse du
     * recruteur est conservée — la candidature se termine alors en un clic.
     */
    const mode = outcome.status === 'external' ? 'externe' : 'bloque';
    application.status = 'echec_envoi';
    application.notes = `${application.notes || ''} — ${message}`;
    application.timeline.push({
      status: 'echec_envoi',
      note: message || 'Candidature à faire hors plateforme.',
    });
    marquerEchec(mode === 'externe' ? 'redirection_externe' : 'plateforme_bloquee');
    return {
      categorie: 'failed',
      offerPatch: { applyMode: mode, ...(outcome.externalUrl ? { applyUrl: outcome.externalUrl } : {}) },
      questions: [],
    };
  }

  // « manual » : l'envoi a bien été tenté, et il n'a pas abouti — formulaire
  // absent, CV refusé, question de l'employeur. Le noter « à postuler » le
  // rendrait indiscernable d'une préparation réussie : c'est précisément ce
  // qu'on veut voir.
  application.status = 'echec_envoi';
  application.notes = `${application.notes || ''} — à finir à la main : ${message}`;
  application.timeline.push({ status: 'echec_envoi', note: message || 'À finir à la main.' });
  marquerEchec('inconnu');
  return { categorie: 'failed', offerPatch: null, questions: champs };
}
