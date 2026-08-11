import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import CvDropzone from '../components/CvDropzone.jsx';

const EMPTY_EXPERIENCE = { role: '', company: '', period: '', description: '' };
const EMPTY_EDUCATION = { degree: '', school: '', period: '' };

function RepeatableList({ title, items, empty, fields, onChange, addLabel }) {
  const update = (index, key) => (e) => {
    const next = [...items];
    next[index] = { ...next[index], [key]: e.target.value };
    onChange(next);
  };
  const remove = (index) => onChange(items.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="builder-block">
      <div className="section-label">{title}</div>

      {items.length === 0 && <p className="muted">Aucune entrée pour l'instant.</p>}

      {items.map((item, index) => (
        <div className="builder-item" key={index}>
          <div className="builder-item-head">
            <span className="muted">#{index + 1}</span>
            <div className="inline">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="Monter"
              >
                ↑
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                title="Descendre"
              >
                ↓
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(index)}>
                Supprimer
              </button>
            </div>
          </div>

          {fields.map((field) =>
            field.multiline ? (
              <div className="field" key={field.key}>
                <label>{field.label}</label>
                <textarea
                  className="textarea"
                  placeholder={field.placeholder}
                  value={item[field.key] || ''}
                  onChange={update(index, field.key)}
                />
              </div>
            ) : (
              <div className="field" key={field.key}>
                <label>{field.label}</label>
                <input
                  className="input"
                  placeholder={field.placeholder}
                  value={item[field.key] || ''}
                  onChange={update(index, field.key)}
                />
              </div>
            )
          )}
        </div>
      ))}

      <button className="btn btn-sm" onClick={() => onChange([...items, { ...empty }])}>
        + {addLabel}
      </button>
    </div>
  );
}

export default function CvBuilderPage() {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

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

  const set = (key) => (e) => {
    setP({ ...p, [key]: e.target.value });
    setNotice(null);
  };
  const setList = (key) => (e) => {
    setP({
      ...p,
      [key]: e.target.value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    });
    setNotice(null);
  };
  const setField = (key) => (value) => {
    setP({ ...p, [key]: value });
    setNotice(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setP(await api.profile.update(p));
      setNotice('Champs enregistrés.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.profile.composeCv(p);
      setP(updated);
      setNotice(
        `CV généré (${updated.cvChars.toLocaleString('fr-FR')} caractères). ` +
          "Il sera réécrit pour chaque offre à laquelle tu candidates."
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mon CV</h1>
          <p>
            Dépose un fichier existant, ou remplis les champs et génère ton CV. Dans les deux cas,
            c'est ce document qui sera réécrit pour chaque offre.
          </p>
        </div>
        <div className="inline">
          <button className="btn" onClick={save} disabled={busy}>
            Enregistrer
          </button>
          <button className="btn btn-primary" onClick={generate} disabled={busy}>
            {busy ? '…' : 'Générer mon CV'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {notice && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          {notice}
        </div>
      )}

      <div className="panel" style={{ maxWidth: 820 }}>
        <CvDropzone profile={p} onChange={setP} />
      </div>

      <div className="panel" style={{ maxWidth: 820 }}>
        <div className="section-label">Identité</div>
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
          <label>En bref (2 à 3 phrases)</label>
          <textarea className="textarea" value={p.summary || ''} onChange={set('summary')} />
        </div>
        <div className="field">
          <label>Compétences (séparées par des virgules)</label>
          <input
            className="input"
            placeholder="React, Node.js, Docker…"
            value={(p.skills || []).join(', ')}
            onChange={setList('skills')}
          />
        </div>

        <RepeatableList
          title="Expériences"
          items={p.experiences || []}
          empty={EMPTY_EXPERIENCE}
          addLabel="Ajouter une expérience"
          onChange={setField('experiences')}
          fields={[
            { key: 'role', label: 'Poste', placeholder: 'Développeur Full Stack' },
            { key: 'company', label: 'Entreprise', placeholder: 'Studio Katana' },
            { key: 'period', label: 'Période', placeholder: '2021 - aujourd’hui' },
            {
              key: 'description',
              label: 'Ce que tu as fait',
              placeholder: 'Faits concrets : stack, réalisations, résultats…',
              multiline: true,
            },
          ]}
        />

        <RepeatableList
          title="Formation"
          items={p.education || []}
          empty={EMPTY_EDUCATION}
          addLabel="Ajouter une formation"
          onChange={setField('education')}
          fields={[
            { key: 'degree', label: 'Diplôme', placeholder: 'Master Informatique' },
            { key: 'school', label: 'École', placeholder: 'Université de Nantes' },
            { key: 'period', label: 'Période', placeholder: '2017 - 2019' },
          ]}
        />
      </div>

      {p.masterCv && (
        <div className="panel" style={{ maxWidth: 820 }}>
          <div className="section-label">
            CV source {p.cvFileName ? `(${p.cvFileName})` : '(généré depuis le formulaire)'}
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 260 }}
            value={p.masterCv}
            onChange={set('masterCv')}
          />
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Modifiable à la main : « Enregistrer » conserve tes corrections, « Générer mon CV »
            reconstruit ce texte depuis les champs ci-dessus.
          </p>
        </div>
      )}
    </>
  );
}
