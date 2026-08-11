import { CONTRACT_LABELS, REMOTE_LABELS, SOURCE_LABELS } from '../lib/status.js';

export const EMPTY_FILTERS = {
  q: '',
  location: '',
  contractType: [],
  remote: [],
  source: [],
};

// Filtres → query string attendue par GET /api/offers
export function toQuery(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.location) params.set('location', filters.location);
  for (const key of ['contractType', 'remote', 'source']) {
    if (filters[key]?.length) params.set(key, filters[key].join(','));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function countActive(filters) {
  return (
    (filters.q ? 1 : 0) +
    (filters.location ? 1 : 0) +
    filters.contractType.length +
    filters.remote.length +
    filters.source.length
  );
}

function ChipGroup({ label, options, selected, onToggle }) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
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

export default function OfferFilters({ filters, onChange, onApplyPreferences, resultCount }) {
  const toggle = (key) => (value) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  const active = countActive(filters);

  return (
    <div className="panel filters">
      <div className="filter-row">
        <input
          className="input"
          placeholder="Rechercher (intitulé, entreprise, mot-clé…)"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
        <input
          className="input"
          placeholder="Lieu"
          style={{ maxWidth: 200 }}
          value={filters.location}
          onChange={(e) => onChange({ ...filters, location: e.target.value })}
        />
      </div>

      <ChipGroup
        label="Contrat"
        options={CONTRACT_LABELS}
        selected={filters.contractType}
        onToggle={toggle('contractType')}
      />
      <ChipGroup
        label="Télétravail"
        options={REMOTE_LABELS}
        selected={filters.remote}
        onToggle={toggle('remote')}
      />
      <ChipGroup
        label="Plateforme"
        options={SOURCE_LABELS}
        selected={filters.source}
        onToggle={toggle('source')}
      />

      <div className="filter-footer">
        <span className="muted">
          {resultCount} offre{resultCount > 1 ? 's' : ''}
          {active > 0 ? ` · ${active} filtre${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''}` : ''}
        </span>
        <div className="inline">
          <button className="btn btn-sm" onClick={onApplyPreferences}>
            Utiliser mes préférences
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            disabled={active === 0}
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}
