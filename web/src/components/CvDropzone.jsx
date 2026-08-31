import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from './Toast.jsx';

const ACCEPTED = '.pdf,.docx,.txt,.md';
const MAX_MB = 5;

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function CvDropzone({ profile, onChange }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasCv = Boolean(profile?.masterCv);

  const send = async (file) => {
    if (!file) return;

    if (!/\.(pdf|docx|txt|md|markdown)$/i.test(file.name)) {
      toast.error('Format non accepté. Dépose un PDF, un DOCX, un TXT ou un MD.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Fichier trop lourd (${MAX_MB} Mo maximum).`);
      return;
    }

    setBusy(true);
    try {
      const updated = await toast.promise(api.profile.uploadCv(file), {
        loading: `Lecture de ${file.name}…`,
        success: (result) =>
          `CV importé (${(result.cvChars || 0).toLocaleString('fr-FR')} caractères).`,
        error: (error) => `Import impossible : ${error.message}`,
      });

      /*
       * L'import ne décide plus rien tout seul.
       *
       * Un `window.confirm` posait la question une fois, au pire moment — juste
       * après le dépôt, avant même d'avoir vu ce qui avait été reconnu — et une
       * réponse « non » perdait la proposition pour de bon. Les deux suites
       * possibles sont désormais deux boutons, disponibles tant que le fichier
       * est là : reprendre les données, ou garder le document tel quel.
       */
      onChange?.(updated);

      if (updated.cvParseMethod && updated.cvParseMethod !== 'modele' && updated.cvParseMethod !== 'heuristique') {
        // La vraie raison, pas « moteur indisponible » : crédit épuisé et panne
        // réseau n'appellent pas la même réaction.
        toast.info(updated.cvParseMethod, { duration: 9000 });
      }
    } catch {
      /* déjà signalé par le toast */
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      onChange?.(await api.profile.removeCv());
      toast.success('CV retiré.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  /** Reprendre les données du fichier dans les rubriques. Remplace, sans fusionner. */
  const reprendreLesDonnees = async () => {
    setBusy(true);
    try {
      const profil = await api.profile.applyCvFields();
      onChange?.(profil);
      toast.success(
        `Rubriques remplies : ${profil.experiences?.length || 0} expérience(s), ` +
          `${profil.education?.length || 0} formation(s). À relire.`
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  /** Choisir lequel des deux CV fait foi — à l'écran comme en candidature. */
  const choisirMode = async (mode) => {
    setBusy(true);
    try {
      onChange?.(await api.profile.setCvMode(mode));
      toast.success(
        mode === 'importe'
          ? 'Le CV importé est affiché et sera envoyé tel quel.'
          : 'Le CV composé ici est affiché et sera envoyé.'
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>Mon CV</label>

      <div
        className={'dropzone' + (dragging ? ' is-dragging' : '') + (busy ? ' is-busy' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          hidden
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {busy ? (
          <p className="dropzone-title">Lecture du CV…</p>
        ) : hasCv ? (
          <>
            <p className="dropzone-title">{profile.cvFileName || 'CV enregistré'}</p>
            <p className="dropzone-hint">
              {profile.cvChars ? `${profile.cvChars.toLocaleString('fr-FR')} caractères` : ''}
              {profile.cvPages ? ` · ${profile.cvPages} page${profile.cvPages > 1 ? 's' : ''}` : ''}
              {profile.cvUploadedAt ? ` · déposé le ${formatDate(profile.cvUploadedAt)}` : ''}
            </p>
            <p className="dropzone-hint">Dépose un nouveau fichier pour le remplacer.</p>
          </>
        ) : (
          <>
            <p className="dropzone-title">Dépose ton CV ici</p>
            <p className="dropzone-hint">PDF, DOCX, TXT ou MD — {MAX_MB} Mo maximum</p>
            <p className="dropzone-hint">
              Il sera réécrit pour chaque offre, pas juste joint tel quel.
            </p>
          </>
        )}
      </div>

      {profile?.cvWarnings?.length > 0 && (
        <ul className="dropzone-warnings">
          {profile.cvWarnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}

      {hasCv && !busy && (
        <div className="cv-import-choix">
          <p className="cv-import-titre">Que faire de ce CV ?</p>

          <div className="cv-import-options">
            {/*
              Deux chemins, montrés côte à côte plutôt qu'enchaînés dans une
              question : reprendre les données, ou garder la mise en page.
              Chacun dit ce qu'il fait à l'aperçu et à la candidature, parce que
              c'est la seule chose qui compte vraiment.
            */}
            <button
              className={'cv-import-option' + (profile?.cvMode === 'compose' ? ' is-actif' : '')}
              onClick={reprendreLesDonnees}
              disabled={!profile?.cvParseMethod}
              title={
                profile?.cvParseMethod
                  ? 'Remplace les rubriques actuelles par celles du fichier.'
                  : "Aucune rubrique n'a pu être reconnue dans ce fichier."
              }
            >
              <span className="cv-import-option-titre">Remplir les rubriques</span>
              <span className="cv-import-option-detail">
                Reprend nom, expériences, formations et compétences du fichier, puis
                garde le gabarit conçu ici. Les rubriques actuelles sont remplacées.
              </span>
            </button>

            <button
              className={'cv-import-option' + (profile?.cvMode === 'importe' ? ' is-actif' : '')}
              onClick={() => choisirMode('importe')}
            >
              <span className="cv-import-option-titre">Garder le CV tel quel</span>
              <span className="cv-import-option-detail">
                Le fichier déposé s'affiche dans l'aperçu et part aux recruteurs sans
                réimpression. Ta mise en page est conservée à l'identique.
              </span>
            </button>
          </div>

          {profile?.cvMode === 'importe' && (
            <p className="cv-import-etat">
              C'est le <strong>fichier importé</strong> qui s'affiche et qui sera envoyé.{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => choisirMode('compose')}>
                Revenir au CV composé ici
              </button>
            </p>
          )}

          {profile?.cvParseMethod === 'heuristique' && (
            <p className="cv-import-etat">
              Rubriques reconnues sans le modèle : relis-les avant d'envoyer.
            </p>
          )}

          <button className="btn btn-ghost btn-sm" onClick={remove}>
            Retirer le CV
          </button>
        </div>
      )}
    </div>
  );
}
