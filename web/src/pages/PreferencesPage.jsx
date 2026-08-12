import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { CONTRACT_LABELS, REMOTE_LABELS, SOURCE_LABELS } from '../lib/status.js';
import { useToast } from '../components/Toast.jsx';
import { TagsField } from '../components/CvFields.jsx';

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
  const toast = useToast();
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.preferences
      .get()
      .then(setPrefs)
      .catch((error) => {
        toast.error(`Préférences illisibles : ${error.message}`);
        setPrefs({});
      });
    // Au montage seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!prefs) {
    return (
      <>
        <div className="skeleton skeleton-line" style={{ width: '35%', height: 28 }} />
        <div className="skeleton skeleton-card" style={{ marginTop: 20, height: 420 }} />
      </>
    );
  }

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

  // `TagsField` a déjà découpé la saisie : on ne reçoit ici qu'une liste propre.
  const setList = (key) => (items) => {
    setPrefs({ ...prefs, [key]: items });
    setSaved(false);
  };

  const setNumber = (key) => (e) => {
    setPrefs({ ...prefs, [key]: Number(e.target.value) });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      setPrefs(await api.preferences.update(prefs));
      setSaved(true);
      toast.success('Préférences enregistrées.');
    } catch (error) {
      toast.error(`Enregistrement impossible : ${error.message}`);
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
        <button
          className={`btn btn-primary${saving ? ' is-busy' : ''}`}
          onClick={save}
          disabled={saving}
        >
          {saved ? 'Enregistré ✓' : 'Enregistrer'}
        </button>
      </div>

      <div className="panel" style={{ maxWidth: 780 }}>
        <TagsField
          label="Métiers et technologies recherchés"
          hint="Séparés par des virgules — les espaces sont autorisés."
          placeholder="développeur full stack, react, node.js…"
          value={prefs.keywords || []}
          onChange={setList('keywords')}
        />

        <TagsField
          label="Mots-clés à écarter"
          placeholder="stage, php, on-site only…"
          value={prefs.excludedKeywords || []}
          onChange={setList('excludedKeywords')}
        />

        <TagsField
          label="Lieux"
          placeholder="Nantes, Paris, France…"
          value={prefs.locations || []}
          onChange={setList('locations')}
        />

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
