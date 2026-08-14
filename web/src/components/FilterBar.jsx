import { UNITES, PRESETS_FRAICHEUR } from '../lib/freshness.js';

/**
 * Barre de filtres partagée par les onglets qui listent des candidatures ou des
 * évènements.
 *
 * Elle est volontairement composée de petites briques exportées plutôt que
 * pilotée par une configuration : chaque page choisit ses filtres, et l'ajout
 * d'un filtre ailleurs ne réécrit pas les autres.
 */

/** Recherche libre. Le champ le plus utilisé, donc le premier. */
export function SearchField({ value, onChange, placeholder = 'Rechercher…' }) {
  return (
    <div className="filter-group filter-grow">
      <span className="filter-label">Recherche</span>
      <div className="filter-search">
        <input
          className="input"
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {value && (
          <button className="filter-clear" onClick={() => onChange('')} title="Effacer">
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Une rangée de pastilles, dont « Tous » en tête. */
export function ChipGroup({ label, value, onChange, options, allLabel = 'Tous' }) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <div className="filter-chips">
        <button
          className={'filter-chip' + (value === '' ? ' active' : '')}
          onClick={() => onChange('')}
        >
          {allLabel}
        </button>
        {options.map((option) => (
          <button
            key={option.value}
            className={'filter-chip' + (value === option.value ? ' active' : '')}
            onClick={() => onChange(option.value)}
            style={value === option.value && option.color ? { borderColor: option.color } : undefined}
          >
            {option.label}
            {typeof option.count === 'number' && <em className="filter-count">{option.count}</em>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Ancienneté maximale, entièrement composable : un raccourci pour aller vite,
 * un couple nombre + unité pour tout le reste. Une annonce de trois semaines et
 * une annonce d'hier ne se jouent pas de la même façon.
 */
export function FreshnessFilter({ value, unit, onChange }) {
  const actif = (preset) => Number(value) === preset.value && unit === preset.unit;

  return (
    <div className="filter-group">
      <span className="filter-label">Publiée depuis moins de</span>
      <div className="filter-chips">
        <button
          className={'filter-chip' + (!value ? ' active' : '')}
          onClick={() => onChange('', unit)}
        >
          Peu importe
        </button>
        {PRESETS_FRAICHEUR.map((preset) => (
          <button
            key={preset.label}
            className={'filter-chip' + (actif(preset) ? ' active' : '')}
            onClick={() => onChange(preset.value, preset.unit)}
          >
            {preset.label}
          </button>
        ))}
        <span className="filter-custom">
          <input
            className="input input-num"
            type="number"
            min="1"
            value={value}
            placeholder="—"
            onChange={(event) => onChange(event.target.value, unit)}
          />
          <select
            className="input"
            value={unit}
            onChange={(event) => onChange(value, event.target.value)}
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
  );
}

/** Nombre maximal de candidats déjà déclarés sur l'offre. */
export function ApplicantsFilter({ value, onChange }) {
  return (
    <div className="filter-group">
      <span className="filter-label">Au plus</span>
      <div className="filter-chips">
        <button
          className={'filter-chip' + (value === '' ? ' active' : '')}
          onClick={() => onChange('')}
        >
          Peu importe
        </button>
        {[5, 10, 25, 50].map((seuil) => (
          <button
            key={seuil}
            className={'filter-chip' + (Number(value) === seuil ? ' active' : '')}
            onClick={() => onChange(seuil)}
          >
            {seuil} candidats
          </button>
        ))}
        <input
          className="input input-num"
          type="number"
          min="0"
          value={value}
          placeholder="—"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

/** Pied de barre : ce que les filtres ont retenu, et de quoi tout remettre à zéro. */
export function FilterFooter({ shown, total, noun = 'résultat', onReset, active }) {
  return (
    <div className="filter-footer">
      <span className="muted">
        {shown === total
          ? `${total} ${noun}${total > 1 ? 's' : ''}`
          : `${shown} ${noun}${shown > 1 ? 's' : ''} sur ${total}`}
      </span>
      {active && (
        <button className="btn btn-ghost btn-sm" onClick={onReset}>
          Réinitialiser
        </button>
      )}
    </div>
  );
}
