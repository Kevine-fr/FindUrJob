import { useMemo } from 'react';
import { STATUS_META, SOURCE_LABELS } from '../lib/status.js';
import { CATEGORIE_PAR_CLE, ORIGINES, PERIODES } from '../lib/activity.js';

/**
 * Le fil d'activité, et les commandes qui le bornent.
 *
 * Un seul composant sert l'onglet Historique et la fiche de compte de la
 * console : les deux montrent la même chose, à un destinataire près. Les
 * dupliquer, c'était s'assurer qu'ils divergent à la première évolution.
 */

function heure(valeur) {
  return new Date(valeur).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function jourCle(valeur) {
  return new Date(valeur).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Ce que la ligne annonce.
 *
 * Un changement de statut porte son libellé métier plutôt que la clé brute :
 * « Envoi échoué » se lit, `echec_envoi` s'interprète.
 */
function titreDe(evenement) {
  if (evenement.type === 'candidature.statut') {
    return STATUS_META[evenement.statut]?.label || evenement.statut;
  }
  return evenement.titre;
}

/** Détail d'une passe de campagne ou d'alerte, en chiffres alignés. */
function DetailChiffre({ detail }) {
  if (!detail || typeof detail !== 'object') return null;

  const lignes = [
    ['examinees', 'examinées'],
    ['preparees', 'préparées'],
    ['envoyees', 'envoyées'],
    ['confirmees', 'confirmées'],
    ['sousLeSeuil', 'sous le seuil'],
    ['correspondances', 'correspondances'],
    ['signalees', 'signalées'],
    ['nombre', 'offres'],
  ].filter(([cle]) => typeof detail[cle] === 'number' && detail[cle] > 0);

  if (!lignes.length) return null;

  return (
    <div className="activity-figures">
      {lignes.map(([cle, label]) => (
        <span key={cle}>
          <strong>{detail[cle].toLocaleString('fr-FR')}</strong> {label}
        </span>
      ))}
    </div>
  );
}

/** Une ligne du fil. */
function Ligne({ evenement }) {
  const categorie = CATEGORIE_PAR_CLE[evenement.categorie];
  const statutMeta = evenement.statut ? STATUS_META[evenement.statut] : null;
  const couleur = statutMeta?.color || categorie?.couleur || 'var(--ink-soft)';

  return (
    <div className={`activity-item activity-${evenement.gravite || 'info'}`}>
      <div className="activity-time">{heure(evenement.at)}</div>

      {/* La pastille porte la couleur de la famille — doublée du libellé
          juste à côté, la couleur seule ne pouvant pas porter le sens. */}
      <span className="activity-dot" style={{ background: couleur }} aria-hidden="true" />

      <div className="activity-body">
        <div className="activity-title">
          <span style={{ color: couleur }}>{titreDe(evenement)}</span>
          {typeof evenement.score === 'number' && (
            <span className="badge">score {evenement.score}</span>
          )}
          {evenement.plateforme && (
            <span className="chip">
              {SOURCE_LABELS[evenement.plateforme] || evenement.plateforme}
            </span>
          )}
        </div>

        {evenement.offre && (
          <div className="activity-meta">
            {evenement.offre.title}
            {evenement.offre.company ? ` · ${evenement.offre.company}` : ''}
            {evenement.offre.source
              ? ` · ${SOURCE_LABELS[evenement.offre.source] || evenement.offre.source}`
              : ''}
          </div>
        )}

        {evenement.resume && <div className="activity-note">{evenement.resume}</div>}
        <DetailChiffre detail={evenement.detail} />
      </div>

      <span className="activity-origin" title={ORIGINES[evenement.origine]?.aide}>
        {ORIGINES[evenement.origine]?.label}
      </span>
    </div>
  );
}

/**
 * Bornes de la période : raccourcis, et deux dates pour le cas précis.
 *
 * Les raccourcis couvrent l'usage courant ; les champs de date servent quand on
 * enquête sur une fenêtre connue — « ce qui s'est passé la semaine du 3 ».
 */
export function PeriodPicker({ value, onChange }) {
  const { preset = '30', from = '', to = '' } = value;
  const surMesure = Boolean(from || to);

  return (
    <div className="filter-group">
      <span className="filter-label">Période</span>
      <div className="filter-chips">
        {PERIODES.map((periode) => (
          <button
            key={periode.value}
            className={'filter-chip' + (!surMesure && preset === periode.value ? ' active' : '')}
            onClick={() => onChange({ preset: periode.value, from: '', to: '' })}
          >
            {periode.label}
          </button>
        ))}
        <span className="filter-custom">
          <input
            type="date"
            className="input input-date"
            value={from}
            max={to || undefined}
            aria-label="Depuis le"
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="muted">→</span>
          <input
            type="date"
            className="input input-date"
            value={to}
            min={from || undefined}
            aria-label="Jusqu'au"
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </span>
      </div>
      {surMesure && (
        <em className="filter-hint">
          Les dates saisies l'emportent sur le raccourci.
        </em>
      )}
    </div>
  );
}

/** Puces de familles, avec le nombre d'évènements de chacune. */
export function CategoryChips({ actives, onToggle, parCategorie = {} }) {
  return (
    <div className="filter-group">
      <span className="filter-label">Famille</span>
      <div className="filter-chips">
        <button
          className={'filter-chip' + (actives.length === 0 ? ' active' : '')}
          onClick={() => onToggle(null)}
        >
          Tout
        </button>
        {Object.values(CATEGORIE_PAR_CLE).map((categorie) => {
          const n = parCategorie[categorie.value] || 0;
          return (
            <button
              key={categorie.value}
              className={'filter-chip' + (actives.includes(categorie.value) ? ' active' : '')}
              onClick={() => onToggle(categorie.value)}
              title={categorie.aide}
            >
              <span className="activity-dot" style={{ background: categorie.couleur }} aria-hidden="true" />
              {categorie.label}
              {n > 0 && <em className="filter-count">{n}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Le fil lui-même, groupé par jour. */
export default function ActivityFeed({ events = [], loading, error, empty }) {
  // L'ordre décroissant vient du serveur : un seul passage suffit à grouper.
  const groupes = useMemo(() => {
    const sortie = [];
    for (const evenement of events) {
      const cle = jourCle(evenement.at);
      const dernier = sortie[sortie.length - 1];
      if (dernier && dernier.cle === cle) dernier.evenements.push(evenement);
      else sortie.push({ cle, evenements: [evenement] });
    }
    return sortie;
  }, [events]);

  if (loading) return <p className="muted">Chargement…</p>;
  if (error) return <div className="empty">Erreur : {error}</div>;
  if (!events.length) return <div className="empty">{empty}</div>;

  return groupes.map((groupe) => (
    <div key={groupe.cle} className="history-day">
      <div className="section-label">
        {groupe.cle}
        <em className="activity-day-count">
          {groupe.evenements.length} évènement{groupe.evenements.length > 1 ? 's' : ''}
        </em>
      </div>
      <div className="panel">
        {groupe.evenements.map((evenement) => (
          <Ligne key={evenement.id} evenement={evenement} />
        ))}
      </div>
    </div>
  ));
}
