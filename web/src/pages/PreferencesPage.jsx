import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { CONTRACT_LABELS, REMOTE_LABELS, SOURCE_LABELS } from '../lib/status.js';

function ChipGroup({ label, hint, options, selected, onToggle }) {
  return (
    <div className="filter-group" style={{ alignItems: 'flex-start' }}>
      <span className="filter-label">
        {label}
        {hint && <em className="filter-hint">{hint}</em>}
      </span>
      <div className="filter-chips">
        {Object.entries(options).map(([value, text]) => (
          <button
            key={value}
            type="button"
            className={'filter-chip' + (selected.includes(value) ? ' active' : '')}
            onClick={() => onToggle(value)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.preferences
      .get()
      .then(setPrefs)
      .catch((e) => {
        setError(e.message);
        setPrefs({});
      });
  }, []);

  if (!prefs) return <p className="muted">Chargement…</p>;

  const toggle = (key) => (value) => {
    const current = prefs[key] || [];
    setPrefs({
      ...prefs,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
    setSaved(false);
  };

  const setList = (key) => (e) => {
    setPrefs({
      ...prefs,
      [key]: e.target.value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    });
    setSaved(false);
  };

  const setNumber = (key) => (e) => {
    setPrefs({ ...prefs, [key]: Number(e.target.value) });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setPrefs(await api.preferences.update(prefs));
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
          <h1>Préférences</h1>
          <p>Ce que tu cherches. Sert de filtre par défaut et cadre les campagnes de candidature.</p>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Enregistrement…' : saved ? 'Enregistré ✓' : 'Enregistrer'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="panel" style={{ maxWidth: 780 }}>
        <div className="field">
          <label>Métiers et technologies recherchés (séparés par des virgules)</label>
          <input
            className="input"
            placeholder="développeur full stack, react, node.js…"
            value={(prefs.keywords || []).join(', ')}
            onChange={setList('keywords')}
          />
        </div>

        <div className="field">
          <label>Mots-clés à écarter</label>
          <input
            className="input"
            placeholder="stage, php, on-site only…"
            value={(prefs.excludedKeywords || []).join(', ')}
            onChange={setList('excludedKeywords')}
          />
        </div>

        <div className="field">
          <label>Lieux</label>
          <input
            className="input"
            placeholder="Nantes, Paris, France…"
            value={(prefs.locations || []).join(', ')}
            onChange={setList('locations')}
          />
        </div>

        <ChipGroup
          label="Contrats"
          options={CONTRACT_LABELS}
          selected={prefs.contractTypes || []}
          onToggle={toggle('contractTypes')}
        />
        <ChipGroup
          label="Télétravail"
          options={REMOTE_LABELS}
          selected={prefs.remotes || []}
          onToggle={toggle('remotes')}
        />
        <ChipGroup
          label="Plateformes"
          options={SOURCE_LABELS}
          selected={prefs.sources || []}
          onToggle={toggle('sources')}
        />

        <div className="grid-2" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Score minimum pour candidater ({prefs.minScore ?? 0}/100)</label>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={prefs.minScore ?? 0}
              onChange={setNumber('minScore')}
              style={{ width: '100%' }}
            />
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              En dessous, l'offre est ignorée par les campagnes.
            </p>
          </div>
          <div className="field">
            <label>Candidatures par jour au maximum</label>
            <input
              className="input"
              type="number"
              min="1"
              max="100"
              value={prefs.dailyQuota ?? 10}
              onChange={setNumber('dailyQuota')}
            />
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Un volume raisonnable passe inaperçu et convertit mieux.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
