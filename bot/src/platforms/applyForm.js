/**
 * Remplissage générique d'un formulaire de candidature.
 *
 * Écrit après avoir sondé HelloWork : les plateformes se ressemblent bien plus
 * que leurs sélecteurs ne le laissent croire. Toutes demandent un nom, un
 * e-mail, un CV et une case à cocher, mais aucune ne nomme ses champs pareil.
 * Plutôt que de deviner un sélecteur par site — ce qui casse à la première
 * refonte — on reconnaît les champs à leur **rôle** : attribut `name`, `id`,
 * `autocomplete`, `placeholder`, `aria-label` et libellé associé.
 *
 * Trois leçons de HelloWork sont câblées ici, parce qu'elles ne sont pas
 * propres à HelloWork :
 *   1. le champ fichier peut être vidé après téléversement (transfert AJAX,
 *      référence rangée dans un champ caché) — il ne prouve donc rien ;
 *   2. le bouton d'envoi vit souvent **hors** du `<form>` ;
 *   3. le parcours compte plusieurs écrans avant la confirmation.
 */

import { humanPause } from './common.js';
import { RAISONS, captchaPresent, cleQuestion } from './failures.js';

/** Ce qu'on sait reconnaître, du plus spécifique au plus général. */
const ROLES = {
  firstName: /pr[ée]nom|first.?name|given.?name|^fname/i,
  lastName: /^nom$|nom.?de.?famille|last.?name|surname|family.?name|^lname/i,
  email: /e.?mail|courriel/i,
  phone: /t[ée]l[ée]?phone|^tel$|phone|mobile|portable/i,
  /*
   * La ville, et c'est un manque qui coûtait cher.
   *
   * La candidature simplifiée de LinkedIn réclame « Location (city) » et refuse
   * d'avancer sans elle. Ne sachant pas la remplir, on cliquait « Suivant » sur
   * un écran qui affichait « Ce champ est obligatoire » en rouge, on
   * revenait sur le même écran, et l'essai finissait par conclure « aucun champ
   * pour joindre le CV » — un diagnostic qui désignait le mauvais coupable, à
   * deux écrans du vrai problème.
   *
   * Le motif exclut `pays` : un champ « Country » attend une valeur d'une liste
   * fermée, et y écrire une ville ferait échouer la validation.
   */
  city: /ville|city|localit[ée]|commune|localisation|^location/i,
};

/** Cases à cocher qu'on accepte : conditions, consentement, RGPD. */
const CONSENT = /cgu|cgv|condition|consent|accept|rgpd|privacy|charte|politique/i;

/** Cases qu'on ne coche jamais : ce serait s'inscrire à autre chose. */
const REFUSE = /newsletter|alerte|publicit|marketing|commercial|partenaire|offres? d/i;

/**
 * Libellés qui envoient pour de bon.
 *
 * Sert de garde-fou au mode essai : quoi qu'une plateforme déclare comme
 * bouton « intermédiaire », un libellé reconnu ici n'est jamais actionné en
 * essai. Un envoi ne se rattrape pas — un employeur ne « dé-reçoit » pas une
 * candidature.
 */
const ENVOI_FINAL =
  /envoyer|soumettre|submit|send|postuler maintenant|valider ma candidature|terminer/i;

/**
 * Le formulaire de candidature de la page, s'il y en a un.
 * Priorité au formulaire portant un champ fichier ; à défaut, celui qui porte
 * un champ e-mail — certaines plateformes reprennent le CV du profil.
 */
async function trouverFormulaire(page) {
  /*
   * On note tous les conteneurs plausibles et on garde le plus riche.
   *
   * Les `<form>` ne suffisent pas : LinkedIn ouvre un `<dialog>` sans balise de
   * formulaire, et Welcome to the Jungle laisse traîner deux dialogues *vides
   * et invisibles* en plus du vrai. Prendre « le dernier dialogue » y
   * choisissait une coquille : le remplissage ne trouvait rien, puis échouait
   * sur « bouton d'envoi introuvable » — un message qui désignait le mauvais
   * coupable.
   *
   * D'où les deux règles : ne considérer que ce qui est **visible**, et
   * préférer le conteneur qui porte un champ fichier, signe le plus sûr d'un
   * formulaire de candidature.
   */
  const candidats = page.locator('form, dialog, [role="dialog"]');
  const total = await candidats.count();

  let meilleur = null;
  let meilleureNote = 0;

  for (let i = 0; i < total; i += 1) {
    const item = candidats.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;

    const note = await item
      .evaluate((el) => {
        const champs = el.querySelectorAll(
          'input:not([type="hidden"]), textarea, select'
        ).length;
        if (!champs) return 0;
        return champs + (el.querySelector('input[type="file"]') ? 100 : 0);
      })
      .catch(() => 0);

    if (note > meilleureNote) {
      meilleureNote = note;
      meilleur = item;
    }
  }

  return meilleur;
}

/**
 * Remplit les champs qu'on sait identifier.
 * On n'écrase jamais une valeur existante : quand la plateforme connaît déjà la
 * personne, ses données valent mieux que les nôtres.
 */
async function remplirChamps(formulaire, valeurs) {
  return formulaire.evaluate(
    (form, { valeurs, roles }) => {
      const motifs = Object.fromEntries(
        Object.entries(roles).map(([cle, source]) => [cle, new RegExp(source, 'i')])
      );

      // Tout ce qui peut nommer un champ, libellé compris.
      const signature = (el) => {
        const libelle = el.labels?.[0]?.textContent || '';
        return [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label'), libelle]
          .filter(Boolean)
          .join(' ');
      };

      const remplis = [];
      const champs = [...form.querySelectorAll('input, textarea')];

      for (const el of champs) {
        if (el.disabled || el.readOnly || el.type === 'hidden' || el.value) continue;

        let role = null;
        if (el.type === 'email') role = 'email';
        else if (el.type === 'tel') role = 'phone';
        else if (el.tagName === 'TEXTAREA') role = 'coverLetter';
        else if (el.type === 'text' || el.type === '') {
          role = Object.keys(motifs).find((cle) => motifs[cle].test(signature(el))) || null;
        }

        const valeur = role && valeurs[role];
        if (!valeur) continue;

        // Passer par le setter natif : React n'entend pas une écriture directe
        // de `.value`, et remettrait son propre état au premier rendu.
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, valeur);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        remplis.push(role);
      }

      return remplis;
    },
    { valeurs, roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.source])) }
  );
}

/**
 * Coche ce qui est obligatoire ou relève du consentement, jamais la publicité.
 * Une case marketing cochée à la place de la personne n'est pas un détail.
 */
async function cocherCases(formulaire) {
  const cases = formulaire.locator('input[type="checkbox"]');
  const total = await cases.count();

  for (let i = 0; i < total; i += 1) {
    const item = cases.nth(i);
    const signature = await item
      .evaluate((el) =>
        [el.name, el.id, el.labels?.[0]?.textContent, el.getAttribute('aria-label')]
          .filter(Boolean)
          .join(' ')
      )
      .catch(() => '');

    const obligatoire = await item.evaluate((el) => el.required).catch(() => false);
    if (REFUSE.test(signature)) continue;
    if (!obligatoire && !CONSENT.test(signature)) continue;
    if (await item.isChecked().catch(() => true)) continue;

    await item.check({ force: true }).catch(() => {});
  }
}

/**
 * Les champs obligatoires encore vides — hors champs fichier (cf. plus bas).
 *
 * `[required]` seul ne suffit pas : LinkedIn n'emploie que `aria-required`, et
 * ses champs manquants passaient donc inaperçus jusqu'à ce que la plateforme
 * refuse l'écran sans qu'on sache pourquoi.
 *
 * Ce qui est rendu, ce sont les **libellés**, pas les `name` ni les `id` : les
 * identifiants de LinkedIn ressemblent à « «rb» » et n'apprennent rien à
 * personne, là où « Mobile phone number » se corrige tout de suite.
 */
/**
 * Décrire un champ : son libellé, sa forme, ses réponses possibles.
 *
 * Écrite une fois et injectée dans la page, parce que trois traitements s'en
 * servent — les champs vides, ceux que la plateforme vient de refuser, et le
 * remplissage depuis les réponses connues. Une heuristique aussi subtile ne
 * supporte pas d'exister en trois exemplaires : celui qui progresse laisse les
 * autres en arrière, et la clé sous laquelle une question est *posée* cesse de
 * correspondre à celle sous laquelle on la *remplit*.
 *
 * Le point délicat est le **groupe de boutons radio**. Le libellé d'un radio
 * est « Oui » ou « Non » ; la question, elle, vit dans le `<legend>` du groupe.
 * S'en tenir au champ faisait enregistrer « Oui » comme question à poser —
 * inexploitable — et c'est pour cela que les deux questions de LinkedIn
 * (« Êtes-vous légalement autorisé(e) à travailler… », « parrainage
 * d'immigration ») n'atteignaient jamais l'onglet Informations.
 */
function outilsDom() {
  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

  const propre = (texte) =>
    String(texte || '')
      .replace(/\s+/g, ' ')
      .replace(/\*$/, '')
      .trim();

  /** Le conteneur qui porte la question d'un groupe de choix, s'il existe. */
  const groupeDe = (el) => {
    if (el.type !== 'radio' && el.type !== 'checkbox') return null;
    return el.closest('fieldset, [role="radiogroup"], [role="group"]');
  };

  /** L'énoncé de la question, y compris quand il coiffe plusieurs boutons. */
  const nommer = (el) => {
    const groupe = groupeDe(el);
    if (groupe) {
      let enonce =
        propre(groupe.querySelector('legend')?.textContent) ||
        propre(groupe.getAttribute('aria-label')) ||
        propre(document.getElementById(groupe.getAttribute('aria-labelledby') || '')?.textContent);

      /*
       * LinkedIn n'étiquette pas ses groupes.
       *
       * Relevé sur un formulaire réel : `<fieldset role="radiogroup">` sans
       * `legend`, sans `aria-label`, sans `aria-labelledby` — l'énoncé n'est
       * qu'un texte libre parmi les enfants, et ses classes sont des empreintes
       * régénérées à chaque déploiement. On retombait donc sur le `name`, du
       * genre « radio-group-«r1h» », qui ne veut rien dire pour personne : la
       * question atterrissait bien dans l'onglet Informations, mais illisible,
       * donc sans réponse possible.
       *
       * On soustrait donc du texte du groupe ce qu'on sait déjà nommer — les
       * libellés des boutons et le message d'erreur — et ce qui reste est la
       * question.
       */
      if (!enonce) {
        const nettoyer = (texte) =>
          String(texte || '')
            .replace(/ce champ est obligatoire|this field is required|champ obligatoire/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        /*
         * L'énoncé est **au-dessus** du groupe, pas dedans.
         *
         * Le `<fieldset>` de LinkedIn ne contient que les boutons : son texte
         * entier vaut « OuiNon ». La question est un frère précédent, dans le
         * bloc parent. On soustrait donc le groupe de son parent, et ce qui
         * reste est l'énoncé — « Êtes-vous légalement autorisé(e) à travailler
         * dans le pays suivant ? France ».
         */
        const dansLeGroupe = nettoyer(groupe.textContent);
        let parent = groupe.parentElement;
        for (let n = 0; n < 3 && parent && !enonce; n += 1) {
          const autour = nettoyer(parent.textContent);
          const reste = nettoyer(dansLeGroupe ? autour.split(dansLeGroupe).join(' ') : autour);
          // Assez long pour être une question, assez court pour ne pas être
          // l'écran entier.
          if (reste.length >= 8 && reste.length <= 200) enonce = reste;
          parent = parent.parentElement;
        }
      }

      // Un groupe sans énoncé ne vaut pas mieux que le libellé du bouton.
      if (enonce) return enonce.slice(0, 120);
    }
    return (
      propre(el.labels?.[0]?.textContent) ||
      propre(el.getAttribute('aria-label')) ||
      propre(el.placeholder) ||
      propre(el.name) ||
      propre(el.type)
    ).slice(0, 120);
  };

  const decrire = (el) => {
    const groupe = groupeDe(el);
    let options = [];

    if (el.tagName === 'SELECT') {
      options = [...el.options]
        .map((o) => propre(o.textContent))
        .filter((t) => t && !/^(choisir|s[ée]lectionner|--)/i.test(t))
        .slice(0, 25);
    } else if (groupe && el.type === 'radio') {
      // Les réponses possibles sont les autres boutons du groupe : sans elles,
      // on demanderait en texte libre ce qui n'accepte que « Oui » ou « Non ».
      options = [...groupe.querySelectorAll('input[type="radio"]')]
        .map((r) => propre(r.labels?.[0]?.textContent || r.value))
        .filter(Boolean)
        .slice(0, 25);
    }

    let forme = 'texte';
    if (el.tagName === 'SELECT') forme = 'choix';
    else if (el.type === 'radio') forme = options.length ? 'choix' : 'texte';
    else if (el.type === 'checkbox') forme = 'case';
    else if (el.type === 'number') forme = 'nombre';
    else if (el.type === 'tel') forme = 'telephone';
    else if (el.type === 'date') forme = 'date';
    else if (el.tagName === 'TEXTAREA') forme = 'paragraphe';

    return { libelle: nommer(el), forme, options };
  };

  return { visible, nommer, decrire, groupeDe, propre };
}

/** La source de l'outil, pour l'injecter dans la page. */
const OUTILS = outilsDom.toString();

/**
 * Les champs que la plateforme vient de refuser, lus dans ses propres messages.
 *
 * Complète `manquants`, qui ne voit que ce que le HTML déclare : LinkedIn
 * valide côté application, sans `required` ni `aria-required`, et affiche « Ce
 * champ est obligatoire » sous le champ fautif. Sans lire ce message, on ne
 * savait pas *lequel* posait problème — seulement que l'écran n'avançait pas.
 *
 * On remonte du message au libellé du champ, parce que c'est le libellé qui
 * permet de poser la question à la personne. « Location (city) » se corrige ;
 * « le troisième champ » ne veut rien dire.
 */
const erreurAffichee = (page) =>
  page
    .evaluate((source) => {
      const { visible, decrire } = new Function(`return ${source}`)()();
      const MOTIF = /ce champ est obligatoire|champ obligatoire|this field is required|required field|veuillez (renseigner|saisir|compl[ée]ter)/i;

      const trouves = [];
      for (const el of document.querySelectorAll('span, div, p, label, small')) {
        const texte = (el.textContent || '').trim();
        if (texte.length > 90 || !MOTIF.test(texte) || !visible(el)) continue;
        if (el.querySelector('span, div, p, label, small')) continue; // on veut la feuille

        /*
         * Le champ fautif est le plus proche au-dessus, dans le même bloc.
         *
         * On remonte jusqu'à six niveaux : LinkedIn intercale le message, le
         * groupe de boutons et son énoncé, ce qui met facilement cinq
         * générations entre l'erreur et le premier `input`. À quatre, les
         * questions à boutons radio n'étaient rattachées à aucun champ, donc
         * pas enregistrées du tout.
         */
        let bloc = el.parentElement;
        let champ = null;
        for (let n = 0; n < 6 && bloc && !champ; n += 1) {
          champ = bloc.querySelector('input:not([type="hidden"]), textarea, select');
          bloc = bloc.parentElement;
        }
        if (!champ) continue;

        const decrit = decrire(champ);
        if (decrit.libelle && !trouves.some((t) => t.libelle === decrit.libelle)) {
          trouves.push(decrit);
        }
      }
      return trouves.slice(0, 6);
    }, OUTILS)
    .then((champs) => champs.map((c) => ({ ...c, cle: cleQuestion(c.libelle) })))
    .catch(() => []);

const manquants = (formulaire) =>
  formulaire
    .evaluate((form, source) => {
      const { visible, decrire } = new Function(`return ${source}`)()();
      const obligatoire = (el) => el.required || el.getAttribute('aria-required') === 'true';

      return [...form.querySelectorAll('input, textarea, select')]
        .filter((el) => el.type !== 'hidden' && visible(el) && obligatoire(el))
        .filter((el) => (el.type === 'checkbox' ? !el.checked : el.type !== 'file' && !el.value))
        .map(decrire)
        .filter((champ) => champ.libelle)
        .slice(0, 8);
    }, OUTILS)
    .catch(() => []);

/**
 * Remplit les champs restants à partir des réponses déjà données.
 *
 * C'est ici que se joue l'apprentissage : la première rencontre avec « Années
 * d'expérience » échoue et pose la question ; une fois répondue, toutes les
 * candidatures suivantes qui la reposent la remplissent seules. Le
 * rapprochement se fait sur le libellé normalisé — le même que celui sous
 * lequel la réponse a été enregistrée.
 */
async function remplirDepuisReponses(formulaire, reponses) {
  if (!reponses || !Object.keys(reponses).length) return [];

  return formulaire
    .evaluate(
      (form, { table, source }) => {
        /*
         * Le même nommage que celui qui a posé la question.
         *
         * C'est la condition pour que la boucle se referme : une question
         * enregistrée sous l'énoncé du groupe et cherchée ici sous le libellé
         * du bouton (« Oui ») ne se retrouverait jamais, et la réponse donnée
         * dans l'onglet Informations resterait sans effet.
         */
        const { nommer, groupeDe, propre } = new Function(`return ${source}`)()();

        const cle = (texte) =>
          String(texte || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 60);

        const remplis = [];
        const groupesVus = new Set();

        for (const el of form.querySelectorAll('input, textarea, select')) {
          if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'file') continue;

          /*
           * Un groupe de boutons radio se traite une fois, pas bouton par bouton.
           *
           * La question est celle du groupe — « Êtes-vous légalement autorisé(e)
           * à travailler… » — et la réponse dit lequel cocher. Les traiter
           * séparément reviendrait à chercher une réponse à « Oui ».
           */
          if (el.type === 'radio') {
            const groupe = groupeDe(el);
            const enonce = nommer(el);
            if (groupesVus.has(enonce)) continue;

            const choix = table[cle(enonce)];
            if (choix === undefined || choix === null || choix === '') continue;
            groupesVus.add(enonce);

            const boutons = groupe
              ? [...groupe.querySelectorAll('input[type="radio"]')]
              : [...form.querySelectorAll(`input[type="radio"][name="${el.name}"]`)];

            const cible = boutons.find(
              (r) => cle(propre(r.labels?.[0]?.textContent || r.value)) === cle(choix)
            );
            if (!cible || cible.checked) continue;

            cible.checked = true;
            cible.dispatchEvent(new Event('click', { bubbles: true }));
            cible.dispatchEvent(new Event('change', { bubbles: true }));
            remplis.push(enonce);
            continue;
          }

          if (el.type !== 'checkbox' && el.value) continue;

          const valeur = table[cle(nommer(el))];
          if (valeur === undefined || valeur === null || valeur === '') continue;

          if (el.type === 'checkbox') {
            // Une réponse « non » à une case obligatoire ne doit pas la cocher
            // en douce : on respecte le refus et le champ restera signalé.
            if (!/^(oui|yes|true|1)$/i.test(String(valeur))) continue;
            if (!el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              remplis.push(nommer(el));
            }
            continue;
          }

          if (el.tagName === 'SELECT') {
            // On vise l'option dont le texte correspond, pas sa position :
            // l'ordre d'une liste change d'une annonce à l'autre.
            const cible = [...el.options].find(
              (o) => cle(o.textContent) === cle(valeur) || o.value === valeur
            );
            if (!cible) continue;
            el.value = cible.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            remplis.push(nommer(el));
            continue;
          }

          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
          Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, String(valeur));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          remplis.push(nommer(el));
        }
        return remplis;
      },
      { table: reponses, source: OUTILS }
    )
    .catch(() => []);
}

/**
 * Les champs fichier de l'écran, rangés par ce qu'ils acceptent.
 *
 * Prendre « le premier champ fichier » était faux, et cher : sur Welcome to
 * the Jungle, le premier est la **photo de profil**. Le CV en PDF y atterrissait
 * et la plateforme répondait « Format non pris en charge : gif, jpeg, png,
 * svg » — un refus provoqué par nous, sur un formulaire qui aurait abouti.
 *
 * On lit donc `accept`, et à défaut le libellé. Un champ qui ne veut que des
 * images n'est pas un champ de CV, et rien ne sert d'y insister : c'est une
 * information à demander à la personne, avec son type.
 */
const champsFichier = (scope) =>
  scope
    .evaluate((form) => {
      const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const nommer = (el) =>
        (
          el.labels?.[0]?.textContent ||
          el.getAttribute('aria-label') ||
          el.closest('label')?.textContent ||
          el.name ||
          ''
        )
          .replace(/\s+/g, ' ')
          .replace(/\*$/, '')
          .trim()
          .slice(0, 60);

      return [...form.querySelectorAll('input[type="file"]')].map((el, index) => {
        const accept = (el.accept || '').toLowerCase();
        const libelle = nommer(el);
        const contexte = `${libelle} ${el.name || ''} ${accept}`.toLowerCase();

        // Un `accept` qui ne cite que des images ferme la question.
        const imagesSeulement =
          Boolean(accept) &&
          accept
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .every((t) => /^image\//.test(t) || /\.(png|jpe?g|gif|svg|webp|bmp)$/.test(t));

        const documentPossible =
          !accept || /pdf|msword|document|\.docx?|\.odt|\.rtf|officedocument/.test(accept);

        return {
          index,
          libelle: libelle || (imagesSeulement ? 'Photo' : 'Document'),
          accept,
          requis: el.required || el.getAttribute('aria-required') === 'true',
          visible: visible(el),
          imagesSeulement,
          // Le CV se reconnaît à ce qu'il accepte, et le libellé départage les
          // champs sans `accept` : « Photo de profil » n'est pas un CV.
          pourCv:
            documentPossible &&
            !imagesSeulement &&
            !/photo|avatar|portrait|image|logo/.test(contexte),
        };
      });
    })
    .catch(() => []);

/**
 * Candidate sur le formulaire de la page courante.
 *
 * @param page          Onglet déjà positionné sur l'annonce, formulaire ouvert.
 * @param cvFile        { name, mimeType, buffer } — le PDF à joindre.
 * @param applicant     { firstName, lastName, email, phone }
 * @param coverLetter   Lettre de motivation.
 * @param dryRun        Remplir jusqu'au bouton d'envoi, sans appuyer.
 * @param submitSelector Sélecteurs d'envoi, du plus sûr au plus large.
 * @param submitText    Libellé du bouton d'action, quand il n'a ni `type=submit`
 *                      ni `aria-label` exploitable.
 * @param confirmPattern Ce que la page doit dire pour qu'on parle d'envoi.
 */
export async function applyForm(
  page,
  {
    cvFile,
    applicant = {},
    coverLetter,
    dryRun = false,
    /*
     * Réponses déjà données par la personne, indexées par libellé normalisé.
     * Alimentées par la page « Informations demandées » : c'est ce qui fait
     * qu'une question posée une fois ne bloque plus jamais.
     */
    answers = {},
    submitSelector = '[data-cy="submitButton"], button[type="submit"], input[type="submit"]',
    submitText = null,
    advanceText = null,
    confirmPattern = /candidature (bien )?(envoy|transmis|enregistr|re[çc]u)|merci pour votre candidature|votre candidature a bien|application (sent|submitted|received)/i,
  } = {}
) {
  const capture = async () => (await page.screenshot({ type: 'png' })).toString('base64');

  /**
   * Un écran du parcours : remplir ce qu'on sait, joindre le CV si son champ
   * est là, cocher les consentements.
   *
   * Le CV n'est pas exigé à chaque écran, et c'est la leçon de LinkedIn : sa
   * candidature simplifiée commence par les coordonnées et ne propose le CV
   * qu'à l'étape suivante. Exiger le champ dès le premier écran faisait
   * abandonner un parcours parfaitement valide.
   */
  async function traiterEcran(scope) {
    await remplirChamps(scope, {
      firstName: applicant.firstName || '',
      lastName: applicant.lastName || '',
      email: applicant.email || '',
      phone: applicant.phone || '',
      city: applicant.city || '',
      coverLetter: coverLetter || '',
    });
    await humanPause(400, 900);

    /*
     * Un champ à suggestions n'est pas rempli tant qu'on n'a pas choisi.
     *
     * « Location (city) » de LinkedIn accepte la frappe, affiche « Paris » —
     * et reste invalide : la plateforme attend qu'on retienne une entrée de sa
     * liste. Sans ce clic, l'écran refusait d'avancer alors que le champ
     * paraissait rempli à l'œil comme à la lecture du DOM.
     *
     * On ne clique que si une liste est réellement ouverte à cet instant, donc
     * juste après notre propre saisie : c'est ce qui rend le geste sûr plutôt
     * qu'un clic au hasard dans la page.
     */
    const suggestion = page
      .locator('[role="option"], [role="listbox"] li, .basic-typeahead__selectable')
      .first();
    if (await suggestion.isVisible().catch(() => false)) {
      await suggestion.click().catch(() => {});
      await humanPause(400, 900);
    }

    let joint = false;
    let depose = false;

    /*
     * Le CV va dans un champ qui accepte des documents, pas dans le premier
     * venu. Les autres champs fichier — une photo de profil, un portfolio —
     * sont pris en charge plus bas : ce sont des informations à fournir, pas
     * des endroits où pousser le CV.
     */
    const fichiers = await champsFichier(scope);
    const pourCv = fichiers.filter((f) => f.pourCv);
    const upload = pourCv.length
      ? scope.locator('input[type="file"]').nth(pourCv[0].index)
      : scope.locator('input[type="file"]').first();

    if (cvFile && pourCv.length) {
      await upload.setInputFiles(cvFile).catch(() => {});
      depose = true;
    } else if (cvFile) {
      /*
       * Pas de champ fichier ? Il n'existe peut-être pas *encore*.
       *
       * L'écran « Resume » de LinkedIn n'en contient aucun : il affiche un
       * bouton « Importer le CV » qui ouvre le sélecteur de fichiers du
       * système. On concluait donc « aucun champ pour joindre le CV » sur
       * l'écran même qui sert à le joindre, et la candidature serait partie
       * avec le CV que LinkedIn garde en mémoire — pas celui qu'on vient
       * d'adapter à l'offre.
       *
       * `filechooser` est la façon dont Playwright intercepte ce sélecteur :
       * le fichier est fourni sans qu'aucune fenêtre système ne s'ouvre.
       */
      const declencheur = scope
        .getByRole('button', {
          name: /importer|t[ée]l[ée]verser|upload|charger|joindre|ajouter (un )?cv/i,
        })
        .first();

      if (await declencheur.isVisible().catch(() => false)) {
        const [selecteur] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
          declencheur.click().catch(() => {}),
        ]);

        if (selecteur) {
          await selecteur.setFiles(cvFile).catch(() => {});
          depose = true;
        } else {
          // Certains sites se contentent de créer le champ au clic.
          const apparu = scope.locator('input[type="file"]').first();
          if (await apparu.count()) {
            await apparu.setInputFiles(cvFile).catch(() => {});
            depose = true;
          }
        }
        await humanPause(600, 1200);
      }
    }

    if (depose) {

      // Le champ fichier ne prouve rien : la plateforme peut le vider après un
      // transfert en arrière-plan et ranger une référence ailleurs. On surveille
      // **ce** conteneur — pas « le premier de la page », qui pourrait être un
      // autre formulaire et ferait conclure à tort à un refus.
      joint = await scope
        .elementHandle()
        .then((handle) =>
          page.waitForFunction(
            ([racine, nom]) => {
              if (!racine) return false;
              if (racine.querySelector('input[type="file"]')?.value) return true;
              const caches = [...racine.querySelectorAll('input[type="hidden"]')];
              if (caches.some((el) => /resume|cv|file|upload|attach/i.test(el.name) && el.value)) {
                return true;
              }
              return racine.textContent.includes(nom);
            },
            [handle, cvFile.name],
            { timeout: 30_000 }
          )
        )
        .then(() => true)
        .catch(() => false);

      if (!joint) {
        return {
          erreur: 'CV non accepté par la plateforme : envoi interrompu.',
          raison: RAISONS.CV_REFUSE,
        };
      }
    }

    // Les réponses connues passent avant le constat de manque : c'est tout
    // l'intérêt de les avoir demandées.
    await remplirDepuisReponses(scope, answers);

    /*
     * Les réponses qui sont des fichiers se déposent, elles ne se tapent pas.
     *
     * `remplirDepuisReponses` travaille dans la page et ne peut pas alimenter
     * un `input[type=file]` — le navigateur l'interdit, à raison. C'est donc
     * Playwright qui le fait ici, depuis les octets que la personne a fournis
     * une fois pour toutes dans l'onglet Informations.
     */
    for (const champ of await champsFichier(scope)) {
      const reponse = answers[cleQuestion(champ.libelle)];
      if (!reponse || typeof reponse !== 'object' || !reponse.contenu) continue;
      await scope
        .locator('input[type="file"]')
        .nth(champ.index)
        .setInputFiles({
          name: reponse.nom || 'piece-jointe',
          mimeType: reponse.mime || 'application/octet-stream',
          buffer: Buffer.from(reponse.contenu, 'base64'),
        })
        .catch(() => {});
      await humanPause(400, 900);
    }

    await cocherCases(scope);
    await humanPause(400, 900);

    /*
     * Les pièces demandées en plus du CV deviennent des questions.
     *
     * Welcome to the Jungle exige une « Photo de profil » et refuse d'envoyer
     * sans elle. Ce n'est ni un défaut de sélecteur ni un mur : c'est une
     * information qu'on n'a pas. Elle rejoint donc les autres dans l'onglet
     * Informations — avec son **type**, sans quoi on demanderait une photo dans
     * un champ de texte.
     *
     * On ne les signale qu'après avoir tenté de les remplir depuis les réponses
     * déjà données : une photo fournie une fois sert partout ensuite.
     */
    const piecesManquantes = [];
    for (const champ of await champsFichier(scope)) {
      if (!champ.requis || !champ.visible) continue;
      if (champ.pourCv && depose) continue;

      const rempli = await scope
        .locator('input[type="file"]')
        .nth(champ.index)
        .evaluate((el) => el.files?.length > 0)
        .catch(() => false);
      if (rempli) continue;

      piecesManquantes.push({
        libelle: champ.libelle,
        forme: champ.imagesSeulement ? 'image' : 'fichier',
        options: [],
        accept: champ.accept || '',
      });
    }

    const vides = [...(await manquants(scope)), ...piecesManquantes];
    if (vides.length) {
      return {
        erreur: `Champs obligatoires non renseignés : ${vides.map((c) => c.libelle).join(', ')}.`,
        raison: RAISONS.CHAMPS_MANQUANTS,
        champs: vides.map((champ) => ({ ...champ, cle: cleQuestion(champ.libelle) })),
      };
    }

    return { joint };
  }

  /*
   * Un contrôle anti-robot se constate avant tout le reste.
   *
   * Sans cette vérification, la page de contrôle était traitée comme une page
   * d'annonce ordinaire : on n'y trouvait pas de formulaire, et l'échec était
   * classé « formulaire absent ». Le diagnostic désignait le mauvais coupable,
   * et surtout il laissait croire à un défaut de sélecteur réparable — alors
   * qu'aucun sélecteur n'aurait aidé.
   */
  if (await captchaPresent(page)) {
    return {
      status: 'manual',
      reason: RAISONS.CAPTCHA,
      message:
        'Contrôle anti-robot sur la page : la candidature doit être terminée à la main ' +
        'depuis la reprise en main.',
      screenshot: await capture(),
    };
  }

  const premier = await trouverFormulaire(page);
  if (!premier) {
    return {
      status: 'manual',
      reason: RAISONS.FORMULAIRE_ABSENT,
      message: "Aucun formulaire de candidature sur la page : à faire depuis l'annonce.",
      screenshot: await capture(),
    };
  }

  const etat = await traiterEcran(premier);
  if (etat.erreur) {
    return {
      status: 'manual',
      reason: etat.raison || RAISONS.INCONNU,
      fields: etat.champs || [],
      message: etat.erreur,
      screenshot: await capture(),
    };
  }
  let cvJoint = etat.joint;

  /*
   * Le bouton d'action de l'écran courant.
   *
   * Deux façons de le reconnaître, parce qu'une seule ne suffit pas : par
   * sélecteur (`type=submit`, attributs propres au site) et par libellé. Le
   * « Suivant » de LinkedIn n'a ni `type=submit` ni `aria-label` — aucun
   * sélecteur ne pouvait l'attraper, et le robot annonçait « bouton d'envoi
   * introuvable » sur un écran qui en affichait un.
   *
   * On cherche d'abord **dans le conteneur** du formulaire, où il se trouve
   * presque toujours, et on n'élargit à la page entière qu'à défaut : les
   * parcours en plusieurs écrans posent parfois le bouton hors du `<form>`, et
   * chercher large d'emblée risquait d'attraper un bouton de pied de page.
   */
  const boutonDans = (portee) => {
    const parSelecteur = portee.locator(submitSelector);
    return submitText
      ? parSelecteur.or(portee.getByRole('button', { name: submitText })).last()
      : parSelecteur.last();
  };

  // La portée suit le parcours : chaque écran a son conteneur, et le bouton du
  // suivant ne se cherche pas dans celui du précédent.
  let portee = premier;
  const bouton = async () => {
    const dedans = boutonDans(portee);
    return (await dedans.isVisible().catch(() => false)) ? dedans : boutonDans(page);
  };
  if (!(await (await bouton()).isVisible().catch(() => false))) {
    return {
      status: 'manual',
      reason: RAISONS.BOUTON_ABSENT,
      message: "Bouton d'envoi introuvable sur la page.",
      screenshot: await capture(),
    };
  }

  if (dryRun) {
    /*
     * L'essai traverse les écrans intermédiaires, jamais le dernier.
     *
     * Sans cela, l'essai s'arrêtait au premier écran et ne pouvait rien dire du
     * CV : la candidature simplifiée de LinkedIn commence par les coordonnées
     * et ne propose le fichier qu'à l'étape suivante. On concluait « aucun
     * champ pour joindre le CV » sur un parcours parfaitement valide.
     *
     * Une seule règle protège l'essai, et elle est absolue : on ne clique que
     * des libellés déclarés comme intermédiaires par la plateforme, et jamais
     * un libellé d'envoi. Un doute sur un bouton = on s'arrête.
     */
    /*
     * Assez d'écrans pour atteindre celui du CV.
     *
     * La limite était de quatre avances, soit cinq écrans. Mesuré sur une
     * candidature simplifiée LinkedIn réelle : le parcours en compte davantage,
     * et l'essai s'arrêtait pile sur « Suivant » pour conclure « aucun champ
     * pour joindre le CV » — sur un formulaire qui en avait un, deux écrans
     * plus loin. Le diagnostic accusait la plateforme d'un défaut qui était le
     * nôtre.
     *
     * Monter la limite ne met rien en danger : la seule règle qui protège
     * l'essai est ailleurs, et elle est absolue — on ne clique que des libellés
     * déclarés intermédiaires, jamais un libellé d'envoi.
     */
    let etapes = 0;
    while (advanceText && etapes < 8) {
      const suite = boutonDans(portee).and(page.getByRole('button', { name: advanceText }));
      const visible = await suite.isVisible().catch(() => false);
      if (!visible) break;

      const nom = (await suite.innerText().catch(() => '')).trim();
      if (!nom || ENVOI_FINAL.test(nom)) break;

      await suite.click().catch(() => {});
      await humanPause(1800, 2800);
      etapes += 1;

      /*
       * Un écran qui refuse d'avancer se dit, il ne se reclique pas.
       *
       * La plateforme peut valider elle-même, sans marquer ses champs
       * `required` ni `aria-required` : nos contrôles ne voient alors rien à
       * signaler, on reclique « Suivant », et on tourne sur le même écran
       * jusqu'à épuiser la limite. L'essai concluait alors sur ce qui manquait
       * *ailleurs* — « aucun champ pour joindre le CV » — au lieu du champ
       * refusé, affiché en rouge sous le formulaire.
       *
       * On lit donc le message d'erreur de la plateforme, et on nomme le champ
       * qu'il désigne : c'est une information à fournir, pas un mystère.
       */
      const refus = await erreurAffichee(page);
      if (refus.length) {
        return {
          status: 'manual',
          reason: RAISONS.CHAMPS_MANQUANTS,
          message: `Écran ${etapes + 1} refusé par la plateforme : ${refus
            .map((c) => c.libelle)
            .join(', ')}.`,
          fields: refus,
          screenshot: await capture(),
        };
      }

      const ecran = await trouverFormulaire(page);
      if (!ecran) break;
      portee = ecran;

      const pas = await traiterEcran(ecran);
      if (pas.erreur) {
        return {
          status: 'manual',
          reason: pas.raison || RAISONS.INCONNU,
          fields: pas.champs || [],
          message: `Essai interrompu à l'étape ${etapes + 1} : ${pas.erreur}`,
          screenshot: await capture(),
        };
      }
      cvJoint = cvJoint || pas.joint;
    }

    // Le CV est le point qui décide de la valeur d'une candidature : le dire
    // explicitement évite de croire un essai concluant alors qu'il partirait nu.
    const libelle = (await (await bouton()).innerText().catch(() => '?')).trim();
    const parcours = etapes ? ` (${etapes + 1} écrans parcourus)` : '';

    return {
      status: cvFile && !cvJoint ? 'manual' : 'dry-run',
      ...(cvFile && !cvJoint ? { reason: RAISONS.CV_SANS_CHAMP } : {}),
      message:
        cvFile && !cvJoint
          ? `Formulaire prêt${parcours}, mais aucun champ pour joindre le CV (bouton « ${libelle} ») : à vérifier avant d'activer l'envoi.`
          : `Prêt à envoyer — non soumis (mode essai)${parcours}. Bouton : « ${libelle} »${cvFile ? ', CV joint' : ''}.`,
      screenshot: await capture(),
    };
  }

  // Plusieurs écrans possibles : on avance tant qu'un bouton d'envoi répond,
  // et on s'arrête net à la confirmation.
  let texte = '';
  for (let etape = 0; etape < 5; etape += 1) {
    if (!(await (await bouton()).isVisible().catch(() => false))) break;

    await (await bouton()).click().catch(() => {});
    await humanPause(2500, 4000);

    texte = await page.innerText('body').catch(() => '');
    if (confirmPattern.test(texte)) {
      return {
        status: 'sent',
        message: cvJoint ? 'Candidature envoyée, CV joint.' : 'Candidature envoyée.',
      };
    }

    // Écran suivant : il peut porter le champ CV, ou ses propres questions.
    const suivant = await trouverFormulaire(page);
    if (!suivant) continue;
    portee = suivant;

    const pas = await traiterEcran(suivant);
    if (pas.erreur) {
      /*
       * Bloqué **après** avoir déjà appuyé sur envoyer : on ne sait pas si la
       * candidature est partie.
       *
       * Constaté en vrai : HelloWork enregistre la candidature dès le premier
       * écran, puis propose un questionnaire complémentaire. Rester coincé
       * dessus n'empêche rien — le recruteur a déjà reçu le dossier. Annoncer
       * un échec à ce stade est faux, et surtout dangereux : cela pousse à
       * recommencer, donc à candidater deux fois.
       */
      return {
        status: 'uncertain',
        reason: RAISONS.POST_ENVOI_INCOMPLET,
        // Les champs restent utiles : c'est ce qui manquait au questionnaire
        // complémentaire, et donc ce qu'il faudra savoir la prochaine fois.
        fields: pas.champs || [],
        message:
          `Candidature soumise, puis étape ${etape + 2} restée incomplète (${pas.erreur}) — ` +
          'à vérifier sur la plateforme avant toute nouvelle tentative.',
        screenshot: await capture(),
      };
    }
    cvJoint = cvJoint || pas.joint;
  }

  // Le bouton a été actionné sans qu'aucune confirmation ne s'affiche : même
  // prudence, on ne conclut ni à l'envoi ni à l'échec.
  return {
    status: 'uncertain',
    reason: RAISONS.SANS_CONFIRMATION,
    message: 'Formulaire soumis sans confirmation visible : à vérifier sur la plateforme.',
    screenshot: await capture(),
  };
}

/**
 * L'annonce renvoie-t-elle vers l'ATS d'un employeur ?
 *
 * Welcome to the Jungle en est l'exemple type : « Postuler » pointe souvent
 * vers `contactrh`, Greenhouse, Lever ou Workday. On ne suit pas ces liens —
 * chaque ATS a son parcours, et candidater à l'aveugle sur un site tiers est le
 * meilleur moyen d'envoyer n'importe quoi.
 */
export async function externalApplyUrl(page, hote) {
  return page
    .evaluate((interne) => {
      const externe = (href) => {
        try {
          const url = new URL(href);
          return /^https?:$/.test(url.protocol) && !url.hostname.endsWith(interne);
        } catch {
          return false;
        }
      };

      const liens = [...document.querySelectorAll('a[href]')].filter((el) => externe(el.href));

      // 1. Le lien se nomme lui-même : « Postuler », « Apply »…
      const parLibelle = liens.find((el) =>
        /postuler|candidater|apply/i.test((el.textContent || '').trim())
      );
      if (parLibelle) return parLibelle.href;

      /*
       * 2. Le lien porte le nom de l'employeur, et c'est son *entourage* qui
       *    dit à quoi il sert.
       *
       * France Travail en est l'exemple : cliquer « Postuler » ouvre une bulle
       * « Postuler sur le site du recruteur » dont l'unique lien s'appelle
       * « ADECCO » ou « HEXAFRET ». Ne regarder que le libellé du lien laissait
       * passer ces annonces, et le robot concluait « Aucun formulaire de
       * candidature sur la page » — un message qui désignait le mauvais
       * coupable et donnait à croire à un bug de sélecteur.
       *
       * On remonte donc quelques niveaux au-dessus du lien pour lire l'intention
       * annoncée. Trois niveaux suffisent en pratique et évitent de remonter
       * jusqu'au corps de page, où le mot « postuler » finit toujours par
       * apparaître quelque part.
       */
      /*
       * « Choisissez le partenaire » compte autant que « site du recruteur ».
       *
       * France Travail a deux bulles, pas une : celle qui nomme l'employeur, et
       * celle qui propose un partenaire de diffusion — DIRECTEMPLOI, PMEJOB.
       * La seconde n'était pas reconnue, et l'annonce repartait en « aucun
       * formulaire de candidature sur la page » alors que le lien de
       * candidature était affiché juste sous le curseur.
       */
      const INTENTION =
        /postuler sur|candidater sur|site du recruteur|site de l['’]employeur|site de l['’]entreprise|choisissez le partenaire|apply on (the )?(company|employer)/i;

      /*
       * On part de la phrase, pas du lien.
       *
       * Remonter depuis le lien en comptant les niveaux ne marche pas : chez
       * France Travail, le titre de la bulle et le lien sont séparés par cinq
       * générations (`div > div > ul > li > div > a`), et une limite assez
       * haute pour les couvrir finit par atteindre le corps de la page, où le
       * mot « postuler » apparaît toujours quelque part.
       *
       * On cherche donc l'élément qui *porte* la phrase — court, donc précis —
       * puis on redescend chercher le lien sous ses ancêtres proches.
       */
      const titres = [...document.querySelectorAll('p, h1, h2, h3, h4, span, div, strong')]
        .filter((el) => {
          const texte = el.textContent || '';
          return texte.length < 120 && INTENTION.test(texte);
        });

      for (const titre of titres) {
        let portee = titre.parentElement;
        for (let niveau = 0; niveau < 4 && portee; niveau += 1) {
          const trouve = [...portee.querySelectorAll('a[href]')].find((el) => externe(el.href));
          if (trouve) return trouve.href;
          portee = portee.parentElement;
        }
      }

      return null;
    }, hote)
    .catch(() => null);
}

/**
 * Candidater sur le site de l'employeur, quand l'annonce y renvoie.
 *
 * Une annonce sur trois environ ne se candidate pas sur la plateforme : elle
 * pointe vers l'outil du recruteur — Greenhouse, Lever, SmartRecruiters,
 * Teamtailor, Welcome Kit… Jusqu'ici on s'arrêtait là, en donnant l'adresse.
 * C'était honnête mais c'était renoncer : ces outils servent tous le même
 * formulaire — nom, adresse, téléphone, CV — celui que le remplisseur générique
 * sait déjà traiter.
 *
 * On tente donc, avec les mêmes garde-fous que partout : jamais d'envoi en mode
 * essai, arrêt net devant un contrôle anti-robot, et les champs qu'on ne sait
 * pas remplir deviennent des questions plutôt que des abandons.
 *
 * L'échec reste un `external` porteur de l'adresse : ne pas savoir remplir le
 * formulaire d'un ATS inconnu n'est pas une panne, et la personne doit garder
 * le lien pour finir à la main.
 */
export async function postulerSurSiteExterne(page, url, options = {}) {
  const externe = {
    status: 'external',
    reason: RAISONS.REDIRECTION_EXTERNE,
    externalUrl: url,
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch {
    return { ...externe, message: `Le site de l'employeur n'a pas répondu : ${url}` };
  }

  const { dismissConsent } = await import('./common.js');
  await dismissConsent(page).catch(() => {});
  await humanPause(1500, 2500);

  /*
   * Les écrans « vérification de sécurité » se lèvent parfois d'eux-mêmes.
   *
   * DirectEmploi, comme beaucoup d'ATS, sert d'abord une page d'attente — « Un
   * instant… », « Vérification de sécurité en cours » — avant de rendre
   * l'annonce. Conclure tout de suite y voyait une page sans formulaire, et
   * l'annonce repartait en redirection alors que le mur n'était peut-être que
   * temporaire. On lui laisse une dizaine de secondes, pas plus : au-delà, il
   * ne se lèvera pas pour un navigateur piloté.
   */
  const ATTENTE = /v[ée]rification de s[ée]curit[ée]|un instant|checking your browser|just a moment|security check/i;
  await page
    .waitForFunction(
      (motif) => !new RegExp(motif, 'i').test(document.body?.innerText || ''),
      ATTENTE.source,
      { timeout: 10_000 }
    )
    .catch(() => {});

  /*
   * Un anti-robot se constate et ne se force pas.
   *
   * Le contrôle de `captchaPresent` cherche des cadres connus (reCAPTCHA,
   * hCaptcha, DataDome) ; certaines protections n'affichent qu'un texte. On
   * lit donc aussi la page, sinon le mur ressortait en « redirection », un
   * diagnostic qui invite à réessayer ce qui ne passera jamais.
   */
  const texteAttente = await page.innerText('body').catch(() => '');
  if (ATTENTE.test(texteAttente) || (await captchaPresent(page))) {
    return {
      status: 'manual',
      reason: RAISONS.CAPTCHA,
      message: `Le site de l'employeur oppose un contrôle anti-robot : ${url}`,
      externalUrl: url,
      screenshot: (await page.screenshot({ type: 'png' })).toString('base64'),
    };
  }

  /*
   * Beaucoup d'ATS n'affichent le formulaire qu'après un « Postuler ».
   *
   * On ne clique que des libellés d'ouverture, jamais d'envoi : la garde du
   * mode essai vit plus bas, mais elle ne protège que ce qu'elle voit.
   */
  const ouvrir = page
    .getByRole('button', { name: /^\s*(postuler|apply( now)?|candidater)\s*$/i })
    .or(page.getByRole('link', { name: /^\s*(postuler|apply( now)?|candidater)\s*$/i }))
    .first();
  if (await ouvrir.isVisible().catch(() => false)) {
    await ouvrir.click().catch(() => {});
    await humanPause(2000, 3000);
  }

  const issue = await applyForm(page, options);

  /*
   * Rien à remplir ici : on rend l'adresse, comme avant.
   *
   * Les deux causes visées sont « aucun formulaire » et « bouton d'envoi
   * introuvable » — c'est ce que rend un ATS dont le parcours nous échappe.
   * Les autres issues, elles, décrivent une tentative réelle : des champs
   * manquants sont des questions à poser, et un envoi est un envoi.
   */
  if (issue.status === 'manual' && [RAISONS.FORMULAIRE_ABSENT, RAISONS.BOUTON_ABSENT].includes(issue.reason)) {
    return {
      ...externe,
      message: `L'employeur reçoit les candidatures sur son propre site : ${url}`,
    };
  }

  return { ...issue, externalUrl: url };
}
