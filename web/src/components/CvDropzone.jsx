import { useRef, useState } from 'react';
import { api } from '../api/client.js';

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
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const hasCv = Boolean(profile?.masterCv);

  const send = async (file) => {
    if (!file) return;
    setError(null);

    if (!/\.(pdf|docx|txt|md|markdown)$/i.test(file.name)) {
      setError('Format non accepté. Dépose un PDF, un DOCX, un TXT ou un MD.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Fichier trop lourd (${MAX_MB} Mo maximum).`);
      return;
    }

    setBusy(true);
    try {
      onChange?.(await api.profile.uploadCv(file));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange?.(await api.profile.removeCv());
    } catch (e) {
      setError(e.message);
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

      {error && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</p>}

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
