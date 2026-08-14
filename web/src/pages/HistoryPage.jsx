import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { STATUS_META, STATUS_ORDER, SOURCE_LABELS } from '../lib/status.js';
import { SearchField, ChipGroup, FilterFooter } from '../components/FilterBar.jsx';

const TYPE_FILTERS = [
  { value: '', label: 'Tout' },
  { value: 'statut', label: 'Changements de statut' },
  { value: 'cv', label: 'CV générés' },
];

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

function dayKey(value) {
  return new Date(value).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function HistoryPage() {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  // Plateforme et recherche se jouent côté client : le serveur renvoie déjà la
  // fenêtre d'évènements, la refiltrer localement évite un aller-retour.
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    const query = params.toString();

    api.history
      .list(query ? `?${query}` : '')
      .then((data) => {
        setEvents(data.events || []);
        setTotal(data.total || 0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [type, status]);

  useEffect(load, [load]);

  const sources = useMemo(
    () =>
      [...new Set(events.map((e) => e.offer?.source).filter(Boolean))].map((value) => ({
        value,
        label: SOURCE_LABELS[value] || value,
      })),
    [events]
  );

  const visibles = useMemo(() => {
    const recherche = q.trim().toLowerCase();
    return events.filter((event) => {
      if (source && event.offer?.source !== source) return false;
      if (!recherche) return true;
      const foin = [event.offer?.title, event.offer?.company, event.note]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return foin.includes(recherche);
    });
  }, [events, source, q]);

  const filtreActif = Boolean(type || status || source || q);

  const reset = () => {
    setType('');
    setStatus('');
    setSource('');
    setQ('');
  };

  // Regroupement par jour, l'ordre du serveur étant déjà décroissant.
  const groups = [];
  for (const event of visibles) {
    const key = dayKey(event.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(event);
    else groups.push({ key, events: [event] });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Historique</h1>
          <p>Tout ce qui s'est passé : changements de statut et CV générés.</p>
        </div>
      </div>

      <div className="panel filters">
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="Intitulé, entreprise, note…"
        />

        <div className="filter-group">
          <span className="filter-label">Type</span>
          <div className="filter-chips">
            {TYPE_FILTERS.map((item) => (
              <button
                key={item.value}
                className={'filter-chip' + (type === item.value ? ' active' : '')}
                onClick={() => setType(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {type !== 'cv' && (
          <div className="filter-group">
            <span className="filter-label">Statut</span>
            <div className="filter-chips">
              <button
                className={'filter-chip' + (status === '' ? ' active' : '')}
                onClick={() => setStatus('')}
              >
                Tous
              </button>
              {STATUS_ORDER.map((value) => (
                <button
                  key={value}
                  className={'filter-chip' + (status === value ? ' active' : '')}
                  onClick={() => setStatus(value)}
                >
                  {STATUS_META[value].label}
                </button>
              ))}
            </div>
          </div>
        )}

        {sources.length > 1 && (
          <ChipGroup
            label="Plateforme"
            value={source}
            onChange={setSource}
            options={sources}
            allLabel="Toutes"
          />
        )}

        <FilterFooter
          shown={visibles.length}
          total={total}
          noun="évènement"
          active={filtreActif}
          onReset={reset}
        />
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : error ? (
        <div className="empty">Erreur : {error}</div>
      ) : events.length === 0 ? (
        <div className="empty">
          Rien à afficher pour l'instant. L'historique se remplit dès que tu suis une offre ou
          génères un CV ✦
        </div>
      ) : visibles.length === 0 ? (
        <div className="empty">
          <strong>Aucun évènement ne correspond</strong>
          Les {events.length} évènements de cette période sont masqués par les filtres.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="history-day">
            <div className="section-label">{group.key}</div>
            <div className="panel">
              {group.events.map((event, index) => {
                const meta = event.status ? STATUS_META[event.status] : null;
                return (
                  <div className="history-item" key={`${event.at}-${index}`}>
                    <div className="history-time">{formatDate(event.at).split(' à ')[1] || ''}</div>
                    <div className="history-body">
                      <div className="history-title">
                        {event.type === 'cv' ? (
                          <>
                            CV généré
                            {typeof event.score === 'number' && (
                              <span className="badge" style={{ marginLeft: 8 }}>
                                score {event.score}
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: meta?.color }}>{meta?.label || event.status}</span>
                        )}
                      </div>
                      <div className="history-meta">
                        {event.offer ? (
                          <>
                            {event.offer.title}
                            {event.offer.company ? ` · ${event.offer.company}` : ''}
                            {event.offer.source
                              ? ` · ${SOURCE_LABELS[event.offer.source] || event.offer.source}`
                              : ''}
                          </>
                        ) : (
                          <span className="muted">Offre supprimée</span>
                        )}
                      </div>
                      {event.note && <div className="history-note">{event.note}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
