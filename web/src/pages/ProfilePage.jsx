import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function ProfilePage() {
  const [p, setP] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.profile
      .get()
      .then(setP)
      .catch((e) => {
        setError(e.message);
        setP({});
      });
  }, []);

  if (!p) return <p className="muted">Chargement…</p>;

  const set = (k) => (e) => {
    setP({ ...p, [k]: e.target.value });
    setSaved(false);
  };
  const setSkills = (e) => {
    setP({
      ...p,
      skills: e.target.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.profile.update(p);
      setP(updated);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profil</h1>
          <p>Ton CV maître : la base que le moteur IA reciblera pour chaque offre.</p>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Enregistrement…' : saved ? 'Enregistré ✓' : 'Enregistrer'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="panel" style={{ maxWidth: 720 }}>
        <div className="grid-2">
          <div className="field">
            <label>Nom complet</label>
            <input className="input" value={p.fullName || ''} onChange={set('fullName')} />
          </div>
          <div className="field">
            <label>Titre</label>
            <input
              className="input"
              placeholder="Développeur Full Stack / DevOps"
              value={p.headline || ''}
              onChange={set('headline')}
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Email</label>
            <input className="input" value={p.email || ''} onChange={set('email')} />
          </div>
          <div className="field">
            <label>Téléphone</label>
            <input className="input" value={p.phone || ''} onChange={set('phone')} />
          </div>
        </div>
        <div className="field">
          <label>Localisation</label>
          <input className="input" value={p.location || ''} onChange={set('location')} />
        </div>
        <div className="field">
          <label>Compétences (séparées par des virgules)</label>
          <input className="input" value={(p.skills || []).join(', ')} onChange={setSkills} />
        </div>
        <div className="field">
          <label>Résumé</label>
          <textarea className="textarea" value={p.summary || ''} onChange={set('summary')} />
        </div>
        <div className="field">
          <label>CV maître</label>
          <textarea
            className="textarea"
            style={{ minHeight: 200 }}
            placeholder="Colle ici ton CV complet (Markdown accepté)…"
            value={p.masterCv || ''}
            onChange={set('masterCv')}
          />
        </div>
      </div>
    </>
  );
}
