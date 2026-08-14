import { CONTRACT_LABELS, REMOTE_LABELS, SOURCE_LABELS } from '../lib/status.js';
import { UNITES, PRESETS_FRAICHEUR } from '../lib/freshness.js';

export const EMPTY_FILTERS = {
  q: "",
  location: "",
  contractType: [],
  remote: [],
  source: [],
  // Fraîcheur : un nombre et son unité, plutôt qu une liste figée de durées.
  publishedWithin: "",
  publishedUnit: "jour",
  // Concurrence : « au plus N candidats ».
  maxApplicants: "",
};

// Filtres → query string attendue par GET /api/offers
export function toQuery(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.location) params.set('location', filters.location);
  for (const key of ["contractType", "remote", "source"]) {
    if (filters[key]?.length) params.set(key, filters[key].join(","));
  }
  if (filters.publishedWithin) {
    params.set("publishedWithin", filters.publishedWithin);
    params.set("publishedUnit", filters.publishedUnit || "jour");
  }
  if (filters.maxApplicants !== "" && filters.maxApplicants !== undefined) {
    params.set("maxApplicants", filters.maxApplicants);
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
    filters.source.length +
    (filters.publishedWithin ? 1 : 0) +
    (filters.maxApplicants !== "" && filters.maxApplicants !== undefined ? 1 : 0)
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

      {/* Fraîcheur : raccourcis courants, puis nombre + unité libres. */}
      <div className="filter-group">
        <span className="filter-label">
          Publiée depuis
          <em className="filter-hint">moins de…</em>
        </span>
        <div className="filter-chips">
          {PRESETS_FRAICHEUR.map((preset) => {
            const actif =
              String(filters.publishedWithin) === String(preset.value) &&
              filters.publishedUnit === preset.unit;
            return (
              <button
                key={preset.label}
                type="button"
                className={'filter-chip' + (actif ? ' active' : '')}
                onClick={() =>
                  onChange({
                    ...filters,
                    publishedWithin: actif ? '' : preset.value,
                    publishedUnit: preset.unit,
                  })
                }
              >
                {preset.label}
              </button>
            );
          })}

          <span className="filter-custom">
            <input
              className="input"
              type="number"
              min="1"
              placeholder="n"
              aria-label="Nombre"
              value={filters.publishedWithin}
              onChange={(e) => onChange({ ...filters, publishedWithin: e.target.value })}
            />
            <select
              className="select"
              aria-label="Unité de temps"
              value={filters.publishedUnit}
              onChange={(e) => onChange({ ...filters, publishedUnit: e.target.value })}
            >
              {UNITES.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      {/* Concurrence : les offres dont on ignore le nombre de candidats sortent
          du filtre — « inconnu » n'est pas « zéro ». */}
      <div className="filter-group">
        <span className="filter-label">
          Candidats
          <em className="filter-hint">au plus</em>
        </span>
        <div className="filter-chips">
          {[5, 10, 25, 50].map((n) => {
            const actif = String(filters.maxApplicants) === String(n);
            return (
              <button
                key={n}
                type="button"
                className={'filter-chip' + (actif ? ' active' : '')}
                onClick={() => onChange({ ...filters, maxApplicants: actif ? '' : n })}
              >
                ≤ {n}
              </button>
            );
          })}
          <span className="filter-custom">
            <input
              className="input"
              type="number"
              min="0"
              placeholder="n"
              aria-label="Nombre maximum de candidats"
              value={filters.maxApplicants}
              onChange={(e) => onChange({ ...filters, maxApplicants: e.target.value })}
            />
          </span>
        </div>
      </div>

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
