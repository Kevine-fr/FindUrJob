import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { SOURCE_LABELS, CONTRACT_LABELS, REMOTE_LABELS } from '../lib/status.js';
import { JOURS, build, parse, describe } from '../lib/cronBuilder.js';
import { UNITES, ilYA } from '../lib/freshness.js';

const HEURES = [6, 7, 8, 9, 10, 12, 14, 17, 19, 21];

/**
 * Champ numérique tolérant.
 *
 * Un `<input type="number">` contrôlé sur un nombre se bloque dès qu'on efface
 * la case : `Number('')` vaut 0, la valeur repart à 0, et il devient impossible
 * de taper « 10 » sans passer par 1 puis 10. On garde donc la frappe telle
 * quelle et on ne recale la valeur qu'à la sortie du champ.
 */
function NumberField({ value, onChange, min = 0, max = 99, className = 'input', style, disabled }) {
  const [text, setText] = useState(String(value ?? ''));
  // Tant que le champ a le focus, la frappe est souveraine : aucune valeur
  // venue d'ailleurs ne vient la réécrire sous les doigts.
  const [saisie, setSaisie] = useState(false);

  useEffect(() => {
    if (!saisie) setText(String(value ?? ''));
  }, [value, saisie]);

  const commit = () => {
    setSaisie(false);
    // Champ vidé : on ne devine pas une intention, on remet la valeur en place.
    if (text.trim() === '') {
      setText(String(value ?? ''));
      return;
    }
    const parsed = Number(text);
    const safe = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setText(String(safe));
    if (safe !== value) onChange(safe);
  };

  return (
    <input
      className={className}
      style={style}
      type="number"
      inputMode="numeric"
      min={min}
      // Un maximum infini ne s'écrit pas dans l'attribut HTML : on l'omet.
      max={Number.isFinite(max) ? max : undefined}
      disabled={disabled}
      value={text}
      onFocus={() => setSaisie(true)}
      onChange={(event) => {
        setText(event.target.value);

        /*
         * On ne remonte que ce qui tient déjà dans les bornes.
         *
         * Auparavant la valeur était bornée à chaque touche puis renvoyée au
         * parent, qui la réinjectait : taper « 150 » affichait « 100 » dès la
         * troisième touche, et le champ semblait refuser toute modification.
         * Hors bornes, on laisse la frappe se poursuivre et on tranche à la
         * sortie du champ, une seule fois.
         */
        const parsed = Number(event.target.value);
        if (event.target.value !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
          onChange(parsed);
        }
      }}
      onBlur={commit}
    />
  );
}

export default function CampaignPage() {
  const toast = useToast();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expert, setExpert] = useState(false);

  const load = useCallback(() => {
    api.campaign
      .get()
      .then((data) => {
        setCampaign(data);
        setExpert(parse(data.cron) === null);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const set = (key) => (value) => setCampaign((c) => ({ ...c, [key]: value }));

  // Lecture du cron courant sous forme de réglages ; repli sur un rythme par
  // défaut quand l'expression sort du cadre simple (l'onglet expert prend alors
  // la main, et rien n'est réécrit dans le dos de l'utilisateur).
  const rythme = useMemo(
    () => parse(campaign?.cron) || { mode: 'heures', hours: [9], days: [1, 2, 3, 4, 5], every: 4 },
    [campaign?.cron]
  );

  const setRythme = (patch) => set('cron')(build({ ...rythme, ...patch }));

  const limitOf = (source) =>
    campaign.targets?.find((target) => target.source === source)?.limit ?? 0;

  const setLimit = (source, limit) => {
    const others = (campaign.targets || []).filter((target) => target.source !== source);
    set('targets')([...others, { source, limit }].filter((target) => target.limit > 0));
  };

  const save = async () => {
    setBusy(true);
    try {
      const updated = await toast.promise(
        api.campaign.update({
          enabled: campaign.enabled,
          cron: campaign.cron,
          mode: campaign.mode,
          cvMode: campaign.cvMode,
          contractTypes: campaign.contractTypes,
          remotes: campaign.remotes,
          dailyLimit: campaign.dailyLimit,
          minScore: campaign.minScore,
          maxAgeValue: campaign.maxAgeValue,
          maxAgeUnit: campaign.maxAgeUnit,
          maxApplicants: campaign.maxApplicants,
          targets: campaign.targets,
        }),
        {
          loading: 'Enregistrement…',
          success: (data) =>
            data.enabled ? `Campagne programmée — ${describe(data.cron)}` : 'Campagne désactivée.',
          error: (err) => err.message,
        }
      );
      setCampaign(updated);
    } catch {
      /*
       * L'enregistrement a échoué : on remet ce que le serveur a réellement.
       *
       * Sans ce rechargement, le formulaire gardait la valeur saisie et donnait
       * tous les signes d'un enregistrement réussi — jusqu'au prochain
       * rafraîchissement de la page, où l'ancienne valeur réapparaissait. D'où
       * l'impression qu'un champ « ne peut pas être modifié » alors que c'est
       * la sauvegarde qui n'était jamais passée.
       */
      load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * `essai` remplit les formulaires jusqu'au bouton d'envoi sans appuyer :
   * de quoi vérifier le parcours d'une plateforme avant d'écrire à un employeur.
   */
  const runNow = async (essai = false) => {
    setBusy(true);
    try {
      const { summary, campaign: updated } = await toast.promise(api.campaign.run(essai), {
        loading: essai ? 'Essai en cours (aucun envoi)…' : 'Exécution de la campagne…',
        success: (res) =>
          res.summary.skipped
            ? `Rien à faire : ${res.summary.skipped}`
            : essai
              ? `${res.summary.ready || 0} formulaire(s) prêt(s) à partir — rien n'a été envoyé.`
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

  const totalParPasse = (campaign.targets || []).reduce((sum, t) => sum + (t.limit || 0), 0);
  const sendables = (campaign.sources || []).filter((s) => s.canSend);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campagne automatique</h1>
          <p>
            Cherche, score et prépare tes candidatures au rythme choisi, source par source. Seules
            les offres au-dessus du seuil de correspondance sont retenues.
          </p>
        </div>
        <div className="inline">
          {/* Un envoi ne se rattrape pas : l'essai passe avant, toujours. */}
          <button
            className={`btn btn-ghost${busy ? ' is-busy' : ''}`}
            onClick={() => runNow(true)}
            disabled={busy}
            title="Remplit les formulaires jusqu'au bouton d'envoi, sans appuyer dessus."
          >
            Tester sans envoyer
          </button>
          <button className={`btn${busy ? ' is-busy' : ''}`} onClick={() => runNow(false)} disabled={busy}>
            Lancer maintenant
          </button>
          <button
            className={`btn btn-primary${busy ? ' is-busy' : ''}`}
            onClick={save}
            disabled={busy}
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div className="grid campaign-grid">
        <div>
          {/* ---- Rythme ---- */}
          <div className="panel">
            <label className="check" style={{ fontSize: 15, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={campaign.enabled}
                onChange={(event) => set('enabled')(event.target.checked)}
              />
              Activer la campagne automatique
            </label>

            <div className="section-label">Rythme</div>
            <p className="rythme-resume">{describe(campaign.cron)}</p>

            {!expert ? (
              <>
                <div className="filter-chips" style={{ marginBottom: 14 }}>
                  <button
                    className={`filter-chip${rythme.mode === 'heures' ? ' active' : ''}`}
                    onClick={() => setRythme({ mode: 'heures' })}
                  >
                    À heures fixes
                  </button>
                  <button
                    className={`filter-chip${rythme.mode === 'intervalle' ? ' active' : ''}`}
                    onClick={() => setRythme({ mode: 'intervalle' })}
                  >
                    À intervalle régulier
                  </button>
                </div>

                {rythme.mode === 'intervalle' ? (
                  <div className="field">
                    <label>Toutes les… (heures)</label>
                    <NumberField
                      value={rythme.every}
                      min={1}
                      max={23}
                      onChange={(every) => setRythme({ every })}
                      style={{ maxWidth: 110 }}
                    />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label>Jours</label>
                      <div className="day-picker">
                        {JOURS.map((jour) => {
                          const actif = rythme.days.includes(jour.value);
                          return (
                            <button
                              key={jour.value}
                              className={`day${actif ? ' active' : ''}`}
                              title={jour.long}
                              aria-pressed={actif}
                              onClick={() =>
                                setRythme({
                                  days: actif
                                    ? rythme.days.filter((d) => d !== jour.value)
                                    : [...rythme.days, jour.value],
                                })
                              }
                            >
                              {jour.court}
                            </button>
                          );
                        })}
                      </div>
                      <span className="filter-hint">
                        Aucun jour coché = tous les jours.
                      </span>
                    </div>

                    <div className="field">
                      <label>Heures</label>
                      <div className="filter-chips">
                        {HEURES.map((heure) => {
                          const actif = rythme.hours.includes(heure);
                          return (
                            <button
                              key={heure}
                              className={`filter-chip${actif ? ' active' : ''}`}
                              onClick={() =>
                                setRythme({
                                  hours: actif
                                    ? rythme.hours.filter((h) => h !== heure)
                                    : [...rythme.hours, heure],
                                })
                              }
                            >
                              {heure}h
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
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
            )}

            <button className="btn btn-ghost btn-sm" onClick={() => setExpert((v) => !v)}>
              {expert ? '← Revenir au réglage simple' : 'Écrire une expression cron →'}
            </button>
          </div>

          {/* ---- Garde-fous ---- */}
          <div className="panel">
            <h2>Garde-fous</h2>
            <div className="grid-2">
              <div className="field">
                <label>Maximum par jour</label>
                <div className="inline" style={{ gap: 12 }}>
                  <NumberField
                    value={campaign.dailyLimit ?? ''}
                    min={1}
                    // Aucun plafond : c'est un garde-fou qu'on se donne, pas
                    // une règle imposée. `Infinity` laisse la saisie libre.
                    max={Infinity}
                    disabled={campaign.dailyLimit == null}
                    onChange={set('dailyLimit')}
                    style={{ width: 110 }}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={campaign.dailyLimit == null}
                      onChange={(event) =>
                        set('dailyLimit')(event.target.checked ? null : 10)
                      }
                    />
                    Sans limite
                  </label>
                </div>
                <span className="filter-hint">
                  Toutes sources confondues.{' '}
                  {campaign.dailyLimit == null
                    ? 'Le volume est alors décidé par les quotas de chaque plateforme.'
                    : `Il en reste ${campaign.remainingToday} aujourd'hui.`}
                </span>
              </div>
              <div className="field">
                <label>Score minimum (%)</label>
                <NumberField value={campaign.minScore} min={0} max={100} onChange={set('minScore')} />
                <span className="filter-hint">En dessous, l'offre est ignorée.</span>
              </div>
            </div>

            {/* Fraîcheur et concurrence : ce qui pèse le plus sur les chances
                de réponse, à effort de candidature égal. */}
            <div className="grid-2">
              <div className="field">
                <label>Offres publiées depuis moins de</label>
                <div className="inline" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <NumberField
                    value={campaign.maxAgeValue}
                    min={0}
                    max={999}
                    onChange={set('maxAgeValue')}
                    style={{ width: 84 }}
                  />
                  <select
                    className="select"
                    value={campaign.maxAgeUnit}
                    onChange={(event) => set('maxAgeUnit')(event.target.value)}
                    style={{ width: 'auto' }}
                  >
                    {UNITES.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="filter-hint">
                  0 = pas de limite. Les offres sans date connue restent éligibles.
                </span>
              </div>

              <div className="field">
                <label>Au plus … candidats</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder="sans limite"
                  value={campaign.maxApplicants ?? ''}
                  onChange={(event) =>
                    set('maxApplicants')(event.target.value === '' ? null : Number(event.target.value))
                  }
                />
                <span className="filter-hint">
                  Vide = sans limite. Les offres au compteur inconnu sont gardées : peu de
                  plateformes l'exposent.
                </span>
              </div>
            </div>

            <div className="section-label">Ce que fait la campagne</div>
            <select
              className="select"
              value={campaign.mode}
              onChange={(event) => set('mode')(event.target.value)}
            >
              <option value="preparer">
                Préparer seulement — CV ciblé + lettre, à relire avant envoi
              </option>
              <option value="envoyer">Préparer et envoyer sur les plateformes connectées</option>
            </select>

            {campaign.mode === 'preparer' && (
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                Les candidatures s'arrêtent au statut « à postuler » : rien n'est envoyé aux
                plateformes. C'est ce mode qui explique une campagne sans trace côté HelloWork.
              </p>
            )}
            {campaign.mode === 'envoyer' && (
              <div className="callout callout-warn" style={{ marginTop: 12, marginBottom: 0 }}>
                <span>⚠</span>
                <div>
                  Les candidatures partent sans relecture sur {sendables.map((s) => SOURCE_LABELS[s.source]).join(', ')},
                  à condition qu'une session y soit ouverte. Vérifie d'abord quelques brouillons.
                </div>
              </div>
            )}

            {/* Le CV joint décide du coût autant que du ciblage : le choix
                mérite d'être explicite plutôt que subi. */}
            {/* Ces filtres sont propres à la campagne : on explore large dans
                l’onglet Offres, on candidate étroit ici. */}
            <div className="section-label">Types de contrat visés</div>
            <div className="filter-chips">
              {Object.entries(CONTRACT_LABELS).map(([valeur, libelle]) => {
                const actif = (campaign.contractTypes || []).includes(valeur);
                return (
                  <button
                    key={valeur}
                    className={`filter-chip${actif ? ' active' : ''}`}
                    onClick={() =>
                      set('contractTypes')(
                        actif
                          ? campaign.contractTypes.filter((v) => v !== valeur)
                          : [...(campaign.contractTypes || []), valeur]
                      )
                    }
                  >
                    {libelle}
                  </button>
                );
              })}
            </div>
            <span className="filter-hint">Aucun coché = tous les contrats.</span>

            <div className="section-label">Mode de travail visé</div>
            <div className="filter-chips">
              {Object.entries(REMOTE_LABELS).map(([valeur, libelle]) => {
                const actif = (campaign.remotes || []).includes(valeur);
                return (
                  <button
                    key={valeur}
                    className={`filter-chip${actif ? ' active' : ''}`}
                    onClick={() =>
                      set('remotes')(
                        actif
                          ? campaign.remotes.filter((v) => v !== valeur)
                          : [...(campaign.remotes || []), valeur]
                      )
                    }
                  >
                    {libelle}
                  </button>
                );
              })}
            </div>
            <span className="filter-hint">Aucun coché = tous les modes.</span>

            <div className="section-label">Quel CV joindre</div>
            <select
              className="select"
              value={campaign.cvMode || 'adaptatif'}
              onChange={(event) => set('cvMode')(event.target.value)}
            >
              <option value="adaptatif">
                CV adaptatif — réécrit par l'IA pour chaque offre
              </option>
              <option value="classique">
                CV classique — celui de l'onglet « Mon CV », joint tel quel
              </option>
            </select>

            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
              {campaign.cvMode === 'classique'
                ? "Aucun appel à l'IA : les candidatures sont gratuites et immédiates. Le ciblage repose alors sur le score, pas sur la réécriture."
                : "Un appel au modèle par candidature. Si l'IA devient indisponible (crédits épuisés, panne), le CV de « Mon CV » prend le relais automatiquement plutôt que d'abandonner la candidature."}
            </p>
          </div>
        </div>

        {/* ---- Quotas par source ---- */}
        <div className="panel">
          <h2>Combien par source</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Nombre de candidatures visées à chaque exécution. Mettre 0 désactive la source.
          </p>

          <div className="targets">
            {(campaign.sources || []).map(({ source, canSend }) => (
              <div className="target" key={source}>
                <div className="target-name">
                  <strong>{SOURCE_LABELS[source] || source}</strong>
                  <span className={`badge ${canSend ? 'badge-send' : ''}`}>
                    {canSend ? 'envoi auto' : 'préparation seule'}
                  </span>
                </div>
                <NumberField
                  value={limitOf(source)}
                  min={0}
                  max={50}
                  onChange={(limit) => setLimit(source, limit)}
                  style={{ width: 78 }}
                />
              </div>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
            {totalParPasse} candidature(s) visée(s) par exécution, plafonnées à{' '}
            {campaign.dailyLimit} par jour.
          </p>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8, marginBottom: 0 }}>
            « Préparation seule » : ces sources renvoient vers le site de l'employeur, sans session
            sur laquelle candidater. La campagne y prépare le dossier, l'envoi reste à ta main.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Dernière exécution</h2>
        {campaign.lastRunAt ? (
          <div className="run-card">
            <div className={`run-state${campaign.running ? ' is-running' : ''}`}>
              <span className="run-dot" />
              {campaign.running ? 'En cours' : 'Terminée'}
            </div>

            <div className="run-body">
              {/* Le résultat d'abord : c'est la réponse à « qu'a fait ma
                  campagne ? ». L'horodatage vient après, en appui. */}
              <p className="run-result">{campaign.lastResult || 'Aucun résultat.'}</p>
              <div className="meta" title={new Date(campaign.lastRunAt).toLocaleString('fr-FR')}>
                {ilYA(campaign.lastRunAt) || '—'}
                {campaign.remainingToday !== null && campaign.remainingToday !== undefined && (
                  <> · {campaign.remainingToday} restante(s) aujourd'hui</>
                )}
              </div>
              {campaign.lastError && <div className="run-error">{campaign.lastError}</div>}
            </div>
          </div>
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
