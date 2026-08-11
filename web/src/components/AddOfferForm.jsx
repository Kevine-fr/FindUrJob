import { useState } from 'react';
import { api } from '../api/client.js';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS } from '../lib/status.js';

const empty = {
  title: '',
  company: '',
  location: '',
  sourceUrl: '',
  source: 'autre',
  contractType: 'autre',
  remote: 'non_precise',
  salary: '',
  description: '',
};

export default function AddOfferForm({ onCreated }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    if (!form.title.trim()) {
      setError('Le titre est obligatoire.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.offers.create(form);
      setForm(empty);
      onCreated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="field">
        <label>URL de l'offre</label>
        <input
          className="input"
          placeholder="https://…"
          value={form.sourceUrl}
          onChange={set('sourceUrl')}
        />
      </div>
      <div className="field">
        <label>Intitulé du poste *</label>
        <input
          className="input"
          placeholder="Développeur Full Stack…"
          value={form.title}
          onChange={set('title')}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Entreprise</label>
          <input className="input" value={form.company} onChange={set('company')} />
        </div>
        <div className="field">
          <label>Lieu</label>
          <input className="input" value={form.location} onChange={set('location')} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Source</label>
          <select className="select" value={form.source} onChange={set('source')}>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Contrat</label>
          <select className="select" value={form.contractType} onChange={set('contractType')}>
            {Object.entries(CONTRACT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Télétravail</label>
          <select className="select" value={form.remote} onChange={set('remote')}>
            {Object.entries(REMOTE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Rémunération</label>
          <input
            className="input"
            placeholder="45–55 k€"
            value={form.salary}
            onChange={set('salary')}
          />
        </div>
      </div>
      <div className="field">
        <label>Description</label>
        <textarea className="textarea" value={form.description} onChange={set('description')} />
      </div>
      {error && <p style={{ color: 'var(--danger)', margin: '0 0 12px' }}>{error}</p>}
      <div className="inline">
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Enregistrement…' : "Enregistrer l'offre"}
        </button>
      </div>
    </div>
  );
}
