import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { SOURCE_LABELS } from '../lib/status.js';

const BOT_PLATFORMS = ['linkedin', 'indeed', 'hellowork'];

export default function CampaignPage() {
  const toast = useToast();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.campaign
      .get()
      .then((data) => {
        setCampaign(data);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const set = (key) => (value) => setCampaign((c) => ({ ...c, [key]: value }));

  const save = async (overrides = {}) => {
    setBusy(true);
    try {
      const body = {
        enabled: campaign.enabled,
        cron: campaign.cron,
        mode: campaign.mode,
        perRun: campaign.perRun,
        dailyLimit: campaign.dailyLimit,
        minScore: campaign.minScore,
        platforms: campaign.platforms,
        ...overrides,
      };
      const updated = await toast.promise(api.campaign.update(body), {
        loading: 'Enregistrement…',
        success: (data) =>
          data.enabled ? `Campagne programmée : ${data.cron}` : 'Campagne désactivée.',
        error: (err) => err.message,
      });
      setCampaign(updated);
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const { summary, campaign: updated } = await toast.promise(api.campaign.run(), {
        loading: 'Exécution de la campagne…',
        success: (res) =>
          res.summary.skipped
            ? `Rien à faire : ${res.summary.skipped}`
            : `${res.summary.prepared} préparée(s), ${res.summary.sent} envoyée(s).`,
        error: (err) => err.message,
      });
      setCampaign(updated);
      if (summary.errors?.length) {
        toast.info(summary.errors.join(' | '), { title: 'Offres en échec', duration: 10000 });
      }
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="empty">
        <strong>Campagne indisponible</strong>
        {error}
      </div>
    );
  }

  if (!campaign) {
    return (
      <>
        <div className="skeleton skeleton-line" style={{ width: '35%', height: 28 }} />
        <div className="skeleton skeleton-card" style={{ marginTop: 20, height: 420 }} />
      </>
    );
  }

  const togglePlatform = (name) =>
    set('platforms')(
      campaign.platforms.includes(name)
        ? campaign.platforms.filter((item) => item !== name)
        : [...campaign.platforms, name]
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campagne automatique</h1>
          <p>
            Cherche, score et prépare tes candidatures au rythme choisi. Les offres viennent de tes
            préférences ; seules celles au-dessus du seuil de correspondance sont retenues.
          </p>
        </div>
        <div className="inline">
          <button className={`btn${busy ? ' is-busy' : ''}`} onClick={runNow} disabled={busy}>
            Lancer maintenant
          </button>
          <button
            className={`btn btn-primary${busy ? ' is-busy' : ''}`}
            onClick={() => save()}
            disabled={busy}
          >
            Enregistrer
          </button>
        </div>
      </div>

      {campaign.mode === 'envoyer' && (
        <div className="callout callout-warn">
          <span>⚠</span>
          <div>
            <strong>Mode envoi direct.</strong> Les candidatures partent sans relecture sur les
            plateformes où une session est ouverte. Vérifie d'abord quelques brouillons en mode
            « préparer ».
          </div>
        </div>
      )}

      <div className="panel" style={{ maxWidth: 820 }}>
        <label className="check" style={{ fontSize: 15, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={campaign.enabled}
            onChange={(event) => set('enabled')(event.target.checked)}
          />
          Activer la campagne automatique
        </label>

        <div className="section-label">Rythme</div>
        <div className="filter-chips" style={{ marginBottom: 12 }}>
          {campaign.presets.map((preset) => (
            <button
              key={preset.id}
              className={`filter-chip${campaign.cron === preset.cron ? ' active' : ''}`}
              onClick={() => set('cron')(preset.cron)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="field">
          <label>
            Expression cron
            <em className="filter-hint">minute heure jour mois jour-semaine</em>
          </label>
          <input
            className="input"
            value={campaign.cron}
            onChange={(event) => set('cron')(event.target.value)}
            style={{ fontFamily: 'ui-monospace, monospace', maxWidth: 260 }}
          />
        </div>

        <div className="section-label">Ce que fait la campagne</div>
        <div className="field">
          <select
            className="select"
            value={campaign.mode}
            onChange={(event) => set('mode')(event.target.value)}
            style={{ maxWidth: 420 }}
          >
            <option value="preparer">
              Préparer seulement — CV ciblé + lettre, à relire avant envoi
            </option>
            <option value="envoyer">Préparer et envoyer sur les plateformes connectées</option>
          </select>
        </div>

        {campaign.mode === 'envoyer' && (
          <div className="field">
            <label>Plateformes autorisées à l'envoi</label>
            <div className="filter-chips">
              {BOT_PLATFORMS.map((name) => (
                <button
                  key={name}
                  className={`filter-chip${campaign.platforms.includes(name) ? ' active' : ''}`}
                  onClick={() => togglePlatform(name)}
                >
                  {SOURCE_LABELS[name] || name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="section-label">Garde-fous</div>
        <div className="grid-3">
          <div className="field">
            <label>Par exécution</label>
            <input
              className="input"
              type="number"
              min="1"
              max="50"
              value={campaign.perRun}
              onChange={(event) => set('perRun')(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label>Maximum par jour</label>
            <input
              className="input"
              type="number"
              min="1"
              max="100"
              value={campaign.dailyLimit}
              onChange={(event) => set('dailyLimit')(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label>Score minimum (%)</label>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              value={campaign.minScore}
              onChange={(event) => set('minScore')(Number(event.target.value))}
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          Il reste {campaign.remainingToday} candidature(s) possible(s) aujourd'hui.
        </p>
      </div>

      <div className="panel" style={{ maxWidth: 820 }}>
        <h2>Dernière exécution</h2>
        {campaign.lastRunAt ? (
          <>
            <div className="meta">
              {new Date(campaign.lastRunAt).toLocaleString('fr-FR')}
              {campaign.running && ' — en cours…'}
            </div>
            <p style={{ marginBottom: 0 }}>{campaign.lastResult || 'Aucun résultat.'}</p>
            {campaign.lastError && (
              <p className="muted" style={{ color: 'var(--danger)', fontSize: 13 }}>
                {campaign.lastError}
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Jamais exécutée. « Lancer maintenant » fait exactement ce que fera la version
            planifiée — c'est le meilleur moyen de vérifier tes réglages.
          </p>
        )}
      </div>
    </>
  );
}
