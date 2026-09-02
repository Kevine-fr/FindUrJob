import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { SearchField, FilterFooter } from '../components/FilterBar.jsx';
import ActivityFeed, { CategoryChips, PeriodPicker } from '../components/ActivityFeed.jsx';
import { bornesDe } from '../lib/activity.js';

/**
 * Tout ce que le compte a produit, en un seul fil.
 *
 * La page ne listait que deux choses — changements de statut et CV ciblés —
 * alors que le reste de l'activité était déjà daté quelque part : les offres
 * collectées, les passes de campagne, les alertes, les sessions de plateforme,
 * les connexions. Le service côté serveur les rassemble ; ici on filtre.
 *
 * Le filtrage part au serveur plutôt que de se faire sur une fenêtre déjà
 * chargée : sur un an d'activité, filtrer localement supposerait d'avoir tout
 * rapatrié d'abord.
 */
export default function HistoryPage() {
  const [data, setData] = useState({ events: [], total: 0, parCategorie: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [periode, setPeriode] = useState({ preset: '30', from: '', to: '' });
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  // La recherche part au serveur : on attend une pause de frappe plutôt que
  // d'émettre une requête par caractère.
  const [qEnvoye, setQEnvoye] = useState('');

  useEffect(() => {
    const minuteur = setTimeout(() => setQEnvoye(q), 350);
    return () => clearTimeout(minuteur);
  }, [q]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    const { from, to } = bornesDe(periode);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (categories.length) params.set('categories', categories.join(','));
    if (qEnvoye.trim()) params.set('q', qEnvoye.trim());
    params.set('limit', '400');

    api.history
      .list(`?${params.toString()}`)
      .then((reponse) => {
        setData(reponse);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periode, categories, qEnvoye]);

  useEffect(load, [load]);

  /** `null` remet tout : les puces se cumulent, « Tout » les efface. */
  const basculer = (categorie) => {
    if (!categorie) return setCategories([]);
    setCategories((actuelles) =>
      actuelles.includes(categorie)
        ? actuelles.filter((c) => c !== categorie)
        : [...actuelles, categorie]
    );
  };

  const filtreActif = Boolean(
    categories.length || q || periode.from || periode.to || periode.preset !== '30'
  );

  const reset = () => {
    setCategories([]);
    setQ('');
    setPeriode({ preset: '30', from: '', to: '' });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Historique</h1>
          <p>
            Tout ce que ce compte a produit : candidatures, CV, offres collectées, passes de
            campagne, alertes, sessions de plateforme et connexions.
          </p>
        </div>
      </div>

      <div className="panel filters">
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="Intitulé, entreprise, plateforme, note…"
        />
        <PeriodPicker value={periode} onChange={setPeriode} />
        <CategoryChips
          actives={categories}
          onToggle={basculer}
          parCategorie={data.parCategorie}
        />
        <FilterFooter
          shown={data.events.length}
          total={data.total}
          noun="évènement"
          active={filtreActif}
          onReset={reset}
        />
      </div>

      <ActivityFeed
        events={data.events}
        loading={loading}
        error={error}
        empty={
          filtreActif
            ? 'Aucun évènement sur cette période avec ces filtres.'
            : "Rien à afficher pour l'instant. Le fil se remplit dès la première offre suivie."
        }
      />

      {/* Le service plafonne chaque source : le dire vaut mieux que laisser
          croire que le compte s'arrête là. */}
      {data.total > data.events.length && (
        <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
          {data.events.length} évènements affichés sur {data.total}. Resserre la période ou une
          famille pour voir le reste.
        </p>
      )}
    </>
  );
}
