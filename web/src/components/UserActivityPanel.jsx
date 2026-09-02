import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { SearchField } from './FilterBar.jsx';
import ActivityFeed, { CategoryChips, PeriodPicker } from './ActivityFeed.jsx';
import { bornesDe } from '../lib/activity.js';
import { SOURCE_LABELS, SESSION_STATE_LABELS, CAMPAIGN_MODE_LABELS } from '../lib/status.js';

/**
 * La fiche d'un compte, vue depuis la console.
 *
 * Même fil que l'onglet Historique de la personne, mêmes filtres, même service
 * côté serveur : un administrateur qui enquête doit voir exactement ce que voit
 * la personne, sinon les deux écrans se contredisent au pire moment.
 *
 * Ce qu'elle ne montre pas : le contenu des CV, des lettres et des notes. La
 * console annonce des volumes et des gestes, pas la matière — c'est la ligne
 * que tient déjà le tableau de bord, et l'étendre ici en ferait une porte
 * dérobée sur les documents de chacun.
 */

function dateCourte(valeur) {
  return valeur ? new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function UserActivityPanel({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [periode, setPeriode] = useState({ preset: '30', from: '', to: '' });
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [qEnvoye, setQEnvoye] = useState('');

  useEffect(() => {
    const minuteur = setTimeout(() => setQEnvoye(q), 350);
    return () => clearTimeout(minuteur);
  }, [q]);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    const params = new URLSearchParams();
    const { from, to } = bornesDe(periode);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (categories.length) params.set('categories', categories.join(','));
    if (qEnvoye.trim()) params.set('q', qEnvoye.trim());
    params.set('limit', '400');

    api.admin
      .userActivity(userId, `?${params.toString()}`)
      .then((reponse) => {
        setData(reponse);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, periode, categories, qEnvoye]);

  useEffect(load, [load]);

  // Échap ferme la fiche : elle se superpose au tableau, on doit pouvoir en
  // sortir sans viser un bouton.
  useEffect(() => {
    const surTouche = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [onClose]);

  const basculer = (categorie) => {
    if (!categorie) return setCategories([]);
    setCategories((actuelles) =>
      actuelles.includes(categorie)
        ? actuelles.filter((c) => c !== categorie)
        : [...actuelles, categorie]
    );
  };

  const compte = data?.user;

  return (
    <div className="activity-sheet">
      <div className="activity-sheet-head">
        <button className="btn btn-ghost btn-sm back-link" onClick={onClose}>
          ← Retour aux comptes
        </button>
      </div>

      {compte && (
        <div className="panel">
          <div className="inline" style={{ gap: 12, alignItems: 'center' }}>
            <span className="nav-avatar">
              {(compte.fullName || compte.email || '?').charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ marginBottom: 2 }}>{compte.fullName || compte.email}</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                {compte.email}
                {compte.role === 'admin' && <span className="badge" style={{ marginLeft: 8 }}>admin</span>}
                {compte.active === false && (
                  <span className="state state-erreur" style={{ marginLeft: 8 }}>désactivé</span>
                )}
              </p>
            </div>
          </div>

          <dl className="facts" style={{ marginTop: 14 }}>
            <div>
              <dt>Inscrit le</dt>
              <dd>{dateCourte(compte.createdAt)}</dd>
            </div>
            <div>
              <dt>Dernière connexion</dt>
              <dd>{dateCourte(compte.lastLoginAt)}</dd>
            </div>
            <div>
              <dt>Connexions</dt>
              <dd>{compte.loginCount ?? 0}</dd>
            </div>
          </dl>

          {/* La campagne et les sessions ne sont pas des évènements : ce sont
              des états courants. Ils cadrent la lecture du fil qui suit. */}
          {data.campagne && (
            <>
              <div className="section-label">Campagne</div>
              <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                {data.campagne.enabled ? 'Active' : 'Inactive'} · rythme{' '}
                <code>{data.campagne.cron}</code> · mode «{' '}
                {CAMPAIGN_MODE_LABELS[data.campagne.mode] || data.campagne.mode} »
                {data.campagne.lastRunAt && ` · dernière passe ${dateCourte(data.campagne.lastRunAt)}`}
              </p>
              {data.campagne.lastError && (
                <p className="callout callout-warn" style={{ marginTop: 8 }}>
                  {data.campagne.lastError}
                </p>
              )}
            </>
          )}

          {data.comptes?.length > 0 && (
            <>
              <div className="section-label">Sessions de plateforme</div>
              <div className="inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                {data.comptes.map((plateforme) => (
                  <span key={plateforme.platform} className={`state state-${plateforme.sessionStatus}`}>
                    {SOURCE_LABELS[plateforme.platform] || plateforme.platform} ·{' '}
                    {SESSION_STATE_LABELS[plateforme.sessionStatus] || plateforme.sessionStatus}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel filters">
        <SearchField value={q} onChange={setQ} placeholder="Intitulé, entreprise, plateforme…" />
        <PeriodPicker value={periode} onChange={setPeriode} />
        <CategoryChips
          actives={categories}
          onToggle={basculer}
          parCategorie={data?.parCategorie || {}}
        />
        {data && (
          <div className="filter-footer">
            <span className="muted">
              {data.events.length} évènement{data.events.length > 1 ? 's' : ''} affiché
              {data.events.length > 1 ? 's' : ''} sur {data.total}
            </span>
          </div>
        )}
      </div>

      <ActivityFeed
        events={data?.events || []}
        loading={loading}
        error={error}
        empty="Aucune activité sur cette période."
      />
    </div>
  );
}
