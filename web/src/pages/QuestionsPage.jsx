import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { SOURCE_LABELS } from '../lib/status.js';

/**
 * Ce que les plateformes réclament, et ce qui bloque.
 *
 * L'écran qui referme la boucle. Une candidature échoue parce qu'un formulaire
 * exige « Années d'expérience » ; la question atterrit ici ; une fois répondue,
 * toutes les candidatures suivantes qui la reposent partent seules.
 *
 * Le diagnostic vit sur le même écran, et pas ailleurs, parce que les deux
 * moitiés se lisent ensemble : la liste dit ce qu'on peut réparer, le tableau
 * dit ce qui restera bloqué quoi qu'on réponde — un captcha ne se règle pas
 * avec une information.
 */

const FORME_AIDE = {
  nombre: 'Un nombre',
  telephone: 'Un numéro de téléphone',
  date: 'Une date',
  paragraphe: 'Quelques phrases',
  case: 'Réponds « oui » pour cocher, « non » pour laisser décoché',
  choix: 'Une valeur de la liste',
  texte: '',
};

/** Une question, et le champ pour y répondre. */
function Question({ question, onEnregistre, onIgnore, onSupprime }) {
  const [valeur, setValeur] = useState(question.reponse || '');
  const [busy, setBusy] = useState(false);
  const modifie = valeur.trim() !== (question.reponse || '').trim();

  const enregistrer = async () => {
    setBusy(true);
    await onEnregistre(question._id, valeur).finally(() => setBusy(false));
  };

  return (
    <div className={`question-card${question.statut === 'repondue' ? ' is-repondue' : ''}`}>
      <div className="question-head">
        <div style={{ minWidth: 0 }}>
          <strong>{question.libelle}</strong>
          <div className="question-meta">
            <span className="chip">{SOURCE_LABELS[question.platform] || question.platform}</span>
            {/* Le compteur est l'argument : une question qui a coûté douze
                candidatures mérite qu'on s'y arrête avant les autres. */}
            <span className="muted">
              {question.rencontres} candidature{question.rencontres > 1 ? 's' : ''} bloquée
              {question.rencontres > 1 ? 's' : ''}
            </span>
            {question.exempleOffre?.title && (
              <span className="muted">· ex. {question.exempleOffre.title}</span>
            )}
          </div>
        </div>
        {question.statut === 'repondue' && <span className="state state-connectee">répondue</span>}
        {question.statut === 'ignoree' && <span className="state state-absente">écartée</span>}
      </div>

      <div className="question-form">
        {question.forme === 'choix' && question.options?.length ? (
          <select className="select" value={valeur} onChange={(e) => setValeur(e.target.value)}>
            <option value="">— choisir —</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : question.forme === 'paragraphe' ? (
          <textarea
            className="textarea"
            rows={3}
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            placeholder={FORME_AIDE[question.forme]}
          />
        ) : (
          <input
            className="input"
            type={question.forme === 'nombre' ? 'number' : 'text'}
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            placeholder={FORME_AIDE[question.forme] || 'Ta réponse'}
          />
        )}

        <button
          className={`btn btn-primary btn-sm${busy ? ' is-busy' : ''}`}
          disabled={busy || !modifie}
          onClick={enregistrer}
        >
          Enregistrer
        </button>
        {question.statut !== 'ignoree' && (
          <button className="btn btn-ghost btn-sm" onClick={() => onIgnore(question._id)}>
            Ne me concerne pas
          </button>
        )}
        <button className="btn btn-danger btn-sm" onClick={() => onSupprime(question._id)}>
          Oublier
        </button>
      </div>
    </div>
  );
}

export default function QuestionsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.questions
      .list()
      .then((reponse) => {
        setData(reponse);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const enregistrer = (id, reponse) =>
    api.questions
      .answer(id, { reponse })
      .then(() => {
        toast.success('Réponse enregistrée : les prochaines candidatures s’en serviront.');
        load();
      })
      .catch((e) => toast.error(e.message));

  const ignorer = (id) =>
    api.questions
      .answer(id, { statut: 'ignoree' })
      .then(load)
      .catch((e) => toast.error(e.message));

  const supprimer = (id) =>
    api.questions
      .remove(id)
      .then(load)
      .catch((e) => toast.error(e.message));

  const { enAttente, repondues, ignorees } = useMemo(() => {
    const liste = data?.questions || [];
    return {
      enAttente: liste.filter((q) => q.statut === 'en_attente'),
      repondues: liste.filter((q) => q.statut === 'repondue'),
      ignorees: liste.filter((q) => q.statut === 'ignoree'),
    };
  }, [data]);

  // Ce qui se répare d'un côté, ce qui ne se répare pas de l'autre. Les
  // mélanger donnerait à croire qu'une réponse peut lever un captcha.
  const { reparables, murs } = useMemo(() => {
    const blocages = data?.blocages || [];
    return {
      reparables: blocages.filter((b) => b.reparable),
      murs: blocages.filter((b) => !b.reparable),
    };
  }, [data]);

  if (error) {
    return (
      <div className="empty">
        <strong>Page indisponible</strong>
        {error}
      </div>
    );
  }

  if (!data) return <p className="muted">Chargement…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Informations demandées</h1>
          <p>
            Ce que les formulaires ont réclamé et qu’on ne savait pas remplir. Chaque réponse
            débloque toutes les candidatures suivantes qui reposent la même question.
          </p>
        </div>
      </div>

      {enAttente.length === 0 && repondues.length === 0 ? (
        <div className="empty">
          <strong>Aucune information à fournir</strong>
          Les formulaires rencontrés jusqu’ici n’ont rien demandé qu’on ne sache déjà remplir.
        </div>
      ) : (
        <>
          {enAttente.length > 0 && (
            <>
              <div className="section-label">
                À renseigner
                <em className="activity-day-count">{enAttente.length}</em>
              </div>
              <div className="panel">
                {enAttente.map((question) => (
                  <Question
                    key={question._id}
                    question={question}
                    onEnregistre={enregistrer}
                    onIgnore={ignorer}
                    onSupprime={supprimer}
                  />
                ))}
              </div>
            </>
          )}

          {repondues.length > 0 && (
            <>
              <div className="section-label">
                Déjà renseignées
                <em className="activity-day-count">{repondues.length}</em>
              </div>
              <div className="panel">
                {repondues.map((question) => (
                  <Question
                    key={question._id}
                    question={question}
                    onEnregistre={enregistrer}
                    onIgnore={ignorer}
                    onSupprime={supprimer}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {(reparables.length > 0 || murs.length > 0) && (
        <>
          <div className="section-label">Ce qui bloque les envois</div>

          {reparables.length > 0 && (
            <div className="panel">
              <h2>Réparable</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                Une information manquante suffit à débloquer ces candidatures.
              </p>
              {reparables.map((blocage) => (
                <div className="blocage" key={`${blocage.raison}-${blocage.plateforme}`}>
                  <span className="chip">
                    {SOURCE_LABELS[blocage.plateforme] || blocage.plateforme}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>{blocage.label}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {blocage.action}
                    </div>
                  </div>
                  <span className="num">{blocage.nombre}</span>
                </div>
              ))}
            </div>
          )}

          {murs.length > 0 && (
            <div className="panel">
              <h2>Hors de portée de l’automatisation</h2>
              {/* Le dire franchement vaut mieux que de laisser espérer : un
                  captcha est une barrière posée volontairement, et une annonce
                  qui renvoie vers l'outil du recruteur n'a rien à recevoir ici. */}
              <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
                Aucune réponse ne lèvera ces blocages — ils demandent un geste humain.
              </p>
              {murs.map((blocage) => (
                <div className="blocage" key={`${blocage.raison}-${blocage.plateforme}`}>
                  <span className="chip">
                    {SOURCE_LABELS[blocage.plateforme] || blocage.plateforme}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>{blocage.label}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {blocage.explication}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>{blocage.action}</div>
                  </div>
                  <span className="num">{blocage.nombre}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {ignorees.length > 0 && (
        <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
          {ignorees.length} question{ignorees.length > 1 ? 's' : ''} écartée
          {ignorees.length > 1 ? 's' : ''}.
        </p>
      )}
    </>
  );
}
