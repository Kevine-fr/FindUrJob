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
       * Les rubriques reconnues ne remplacent rien sans accord explicite.
       *
       * Un import écrase potentiellement des heures de saisie. Le serveur les
       * renvoie comme proposition ; c'est ici, et seulement après un « oui »,
       * qu'elles sont appliquées. Le gabarit du CV ne change pas — seules les
       * données changent, donc l'aperçu reste celui qu'on a conçu.
       */
      const champs = updated.fields;
      const compte = champs
        ? (champs.experiences?.length || 0) + (champs.education?.length || 0)
        : 0;

      if (compte > 0) {
        const remplacer = window.confirm(
          `${file.name} a été lu.\n\n` +
            `${champs.experiences?.length || 0} expérience(s) et ` +
            `${champs.education?.length || 0} formation(s) y ont été reconnues.\n\n` +
            `Remplacer les rubriques actuelles de ton CV par celles-ci ?\n\n` +
            `Le format de ton CV ne change pas : seules les informations sont ` +
            `reprises. Tes rubriques actuelles seront perdues.`
        );

        if (remplacer) {
          // On ne fusionne pas : mélanger deux CV produit des doublons que
          // personne ne relit. Remplacer est franc, et c'est ce qu'on a annoncé.
          onChange?.({ ...updated, ...champs });
          toast.success('Rubriques remplacées par celles du CV importé.');
          return;
        }
        toast.info('Rubriques conservées : seul le texte source a été mis à jour.');
      } else if (champs === null) {
        toast.info(
          "Le texte a été importé, mais les rubriques n'ont pas pu en être extraites " +
            "(moteur IA indisponible). Ton CV actuel est inchangé.",
          { duration: 9000 }
        );
      }

      onChange?.(updated);
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
        <div className="inline" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={remove}>
            Retirer le CV
          </button>
        </div>
      )}
    </div>
  );
}
