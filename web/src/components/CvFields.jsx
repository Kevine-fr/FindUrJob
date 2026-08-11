import { useState } from 'react';

const chevron = (
  <svg className="acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Section repliable. Un CV a dix rubriques : tout déplier noie l'essentiel. */
export function Accordion({ title, icon, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`acc${open ? ' is-open' : ''}`}>
      <button className="acc-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="acc-title">
          {icon}
          {title}
          {count > 0 && <span className="acc-count">{count}</span>}
        </span>
        {chevron}
      </button>
      {open && <div className="acc-body">{children}</div>}
    </section>
  );
}

/** Un champ texte simple, mono ou multiligne. */
export function Field({ label, value, onChange, placeholder, multiline, type = 'text' }) {
  const props = {
    className: multiline ? 'textarea' : 'input',
    value: value || '',
    placeholder,
    onChange: (event) => onChange(event.target.value),
  };
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {multiline ? <textarea {...props} /> : <input type={type} {...props} />}
    </div>
  );
}

/**
 * Les puces d'une expérience.
 *
 * C'est la matière que l'ajustement à une page sacrifie en dernier recours, et
 * ce qu'un recruteur lit en premier : elles méritent leur propre éditeur plutôt
 * qu'un paragraphe libre.
 */
export function BulletList({ bullets = [], onChange }) {
  const update = (index, value) => {
    const next = [...bullets];
    next[index] = value;
    onChange(next);
  };

  return (
    <div className="field">
      <label>Faits marquants</label>
      {bullets.map((bullet, index) => (
        <div className="inline" key={index} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
          <input
            className="input"
            value={bullet}
            placeholder="Résultat concret, chiffré si possible"
            onChange={(event) => update(index, event.target.value)}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onChange(bullets.filter((_, i) => i !== index))}
            aria-label={`Supprimer la puce ${index + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      <button className="btn btn-sm" onClick={() => onChange([...bullets, ''])}>
        + Ajouter un fait
      </button>
    </div>
  );
}

/**
 * Liste d'entrées identiques (expériences, formations, certifications…).
 *
 * L'ordre compte dans un CV — et il compte doublement ici : c'est lui qui
 * décide quelles puces seront rognées en premier si la page déborde.
 */
export function Repeatable({ items = [], empty, addLabel, onChange, renderItem, titleOf }) {
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const patch = (index) => (key, value) => {
    const next = [...items];
    next[index] = { ...next[index], [key]: value };
    onChange(next);
  };

  return (
    <>
      {items.length === 0 && (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Aucune entrée pour l'instant.
        </p>
      )}

      {items.map((item, index) => (
        <div className="builder-item" key={index}>
          <div className="builder-item-head">
            <strong style={{ fontSize: 13.5 }}>
              {titleOf?.(item) || `#${index + 1}`}
            </strong>
            <div className="inline" style={{ gap: 4 }}>
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
              <button
                className="btn btn-danger btn-sm"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Supprimer
              </button>
            </div>
          </div>
          {renderItem(item, patch(index))}
        </div>
      ))}

      <button className="btn btn-sm" onClick={() => onChange([...items, { ...empty }])}>
        + {addLabel}
      </button>
    </>
  );
}
