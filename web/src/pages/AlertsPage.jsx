import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { STATUS_META, SOURCE_LABELS, SOURCE_COLORS } from '../lib/status.js';
import { UNITES, PRESETS_FRAICHEUR } from '../lib/freshness.js';
import { activerPush, desactiverPush, abonnementActuel, pushSupporte } from '../lib/push.js';

/**
 * Alertes.
 *
 * Les critères sont exactement ceux de l'onglet Candidatures : on règle une
 * alerte comme on filtre une liste. Une échéance facultative les accompagne :
 * passée cette date, l'alerte s'éteint d'elle-même plutôt que de continuer à
 * parler d'une recherche terminée.
 */

/** Rythmes courants. Le cron reste modifiable pour qui veut autre chose. */
const RYTHMES = [
  { cron: '0 * * * *', label: 'Toutes les heures' },
  { cron: '0 */3 * * *', label: 'Toutes les 3 heures' },
  { cron: '0 8,18 * * *', label: 'Matin et soir' },
  { cron: '0 8 * * *', label: 'Chaque matin' },
  { cron: '0 8 * * 1', label: 'Chaque lundi' },
];

const VIDE = {
  name: 'Nouvelle alerte',
  enabled: true,
  q: '',
  statuses: [],
  sources: [],
  maxAgeValue: 0,
  maxAgeUnit: 'jour',
  maxApplicants: null,
  email: true,
  push: false,
  cron: '0 8 * * *',
  expiresAt: null,
};

const PLATEFORMES = Object.keys(SOURCE_LABELS);

/*
 * Les statuts sur lesquels une alerte a un sens.
 *
 * « Relancé », « Entretien », « Refusé » et « Abandonné » se posent à la main
 * depuis la fiche d'une candidature : être prévenu d'un état qu'on vient
 * soi-même d'inscrire n'apprend rien. Restent ceux que l'application écrit
 * elle-même, plus « Postulé » et « Offre », qui marquent une vraie étape.
 */
const STATUTS_ALERTE = ['brouillon', 'a_postuler', 'echec_envoi', 'a_verifier', 'postule', 'offre'];

/** `2026-08-26` pour un `<input type="date">`. */
const enDate = (valeur) => (valeur ? new Date(valeur).toISOString().slice(0, 10) : '');

function Bascule({ actif, onChange, children, disabled, titre }) {
  return (
    <button
      type="button"
      className={'filter-chip' + (actif ? ' active' : '')}
      onClick={() => onChange(!actif)}
      disabled={disabled}
      title={titre}
    >
      {children}
    </button>
  );
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [channels, setChannels] = useState({ email: false, push: false, devices: 0 });
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [edition, setEdition] = useState(null); // brouillon en cours
  const [apercu, setApercu] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [pushEtat, setPushEtat] = useState({ abonne: false, message: '' });

  const load = useCallback(() => {
    setLoading(true);
    api.alerts
      .list()
      .then((data) => {
        setAlerts(data.alerts || []);
        setChannels(data.channels || {});
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // L'état d'abonnement se lit sur l'appareil, pas sur le serveur : un compte
  // peut être abonné ailleurs et pas ici.
  useEffect(() => {
    abonnementActuel()
      .then((a) => setPushEtat((etat) => ({ ...etat, abonne: Boolean(a) })))
      .catch(() => {});
  }, []);

  const ouvrir = (alerte) =>
    setEdition(
      alerte
        ? { ...alerte, expiresAt: enDate(alerte.expiresAt) }
        : { ...VIDE, expiresAt: '' }
    );

  const set = (cle, valeur) => setEdition((e) => ({ ...e, [cle]: valeur }));

  const bascule = (cle, valeur) =>
    setEdition((e) => {
      const liste = e[cle] || [];
      return {
        ...e,
        [cle]: liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur],
      };
    });

  const enregistrer = async () => {
    setOccupe(true);
    const corps = { ...edition, expiresAt: edition.expiresAt || null };
    try {
      if (edition._id) await api.alerts.update(edition._id, corps);
      else await api.alerts.create(corps);
      setEdition(null);
      setApercu(null);
      load();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async (alerte) => {
    if (!window.confirm(`Supprimer l'alerte « ${alerte.name} » ?`)) return;
    await api.alerts.remove(alerte._id).catch((e) => setErreur(e.message));
    if (edition?._id === alerte._id) setEdition(null);
    load();
  };

  const voirApercu = async () => {
    if (!edition?._id) return;
    setOccupe(true);
    try {
      setApercu(await api.alerts.preview(edition._id));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  const basculerPush = async () => {
    setPushEtat((etat) => ({ ...etat, message: 'Un instant…' }));
    const resultat = pushEtat.abonne ? await desactiverPush() : await activerPush();
    setPushEtat({
      abonne: resultat.ok ? !pushEtat.abonne : pushEtat.abonne,
      message: resultat.ok ? '' : resultat.raison,
    });
    load();
  };

  const testerPush = async () => {
    const bilan = await api.push.test().catch((e) => ({ sent: 0, reason: e.message }));
    setPushEtat((etat) => ({
      ...etat,
      message: bilan.sent
        ? `Notification envoyée à ${bilan.sent} appareil(s).`
        : `Rien envoyé : ${bilan.reason || 'aucun appareil abonné'}.`,
    }));
  };

  const rythmeConnu = useMemo(
    () => RYTHMES.find((r) => r.cron === edition?.cron),
    [edition?.cron]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alertes</h1>
          <p>
            Sois prévenu quand des candidatures correspondent à tes critères — les mêmes que
            l'onglet Candidatures. Par courriel, par notification, ou les deux.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => ouvrir(null)}>
          Nouvelle alerte
        </button>
      </div>

      {erreur && <div className="empty">Erreur : {erreur}</div>}

      {/* Les canaux d'abord : régler une alerte dont le canal est muet
          n'apprendrait son inutilité qu'au premier déclenchement. */}
      <div className="panel">
        <div className="section-label">Comment être prévenu</div>

        <div className="alert-canaux">
          <div className="alert-canal">
            <strong>Courriel</strong>
            <span className="muted">
              {channels.email
                ? 'Configuré — les alertes partent vers ton adresse de compte.'
                : "Aucun serveur SMTP configuré : les courriels ne partiront pas. Les alertes restent consultables ici."}
            </span>
          </div>

          <div className="alert-canal">
            <strong>Notifications</strong>
            <span className="muted">
              {!pushSupporte()
                ? "Ce navigateur ne gère pas les notifications push."
                : !channels.push
                  ? "Le serveur n'a pas de clés VAPID : canal indisponible pour l'instant."
                  : pushEtat.abonne
                    ? `Actives sur cet appareil · ${channels.devices || 0} appareil(s) au total.`
                    : `Inactives sur cet appareil · ${channels.devices || 0} appareil(s) au total.`}
            </span>
            <div className="row">
              <button
                className={'btn btn-sm' + (pushEtat.abonne ? '' : ' btn-primary')}
                onClick={basculerPush}
                disabled={!pushSupporte() || !channels.push}
              >
                {pushEtat.abonne ? 'Désactiver ici' : 'Activer sur cet appareil'}
              </button>
              {pushEtat.abonne && (
                <button className="btn btn-ghost btn-sm" onClick={testerPush}>
                  Envoyer un test
                </button>
              )}
            </div>
            {pushEtat.message && <span className="alert-message">{pushEtat.message}</span>}
          </div>
        </div>
      </div>

      {/* --- Éditeur --- */}
      {edition && (
        <div className="panel alert-editeur">
          <div className="alert-editeur-tete">
            <input
              className="input alert-nom"
              value={edition.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Nom de l'alerte"
            />
            <Bascule actif={edition.enabled} onChange={(v) => set('enabled', v)}>
              {edition.enabled ? 'Active' : 'En pause'}
            </Bascule>
          </div>

          <div className="filter-group filter-grow">
            <span className="filter-label">Recherche</span>
            <input
              className="input"
              value={edition.q}
              onChange={(e) => set('q', e.target.value)}
              placeholder="Intitulé, entreprise, ville, note…"
            />
          </div>

          <div className="filter-group">
            <span className="filter-label">Statut</span>
            <div className="filter-chips">
              {STATUTS_ALERTE.map((statut) => (
                <Bascule
                  key={statut}
                  actif={edition.statuses.includes(statut)}
                  onChange={() => bascule('statuses', statut)}
                >
                  {STATUS_META[statut]?.label || statut}
                </Bascule>
              ))}
            </div>
            <span className="muted alert-aide">Aucun coché = tous les statuts.</span>
          </div>

          <div className="filter-group">
            <span className="filter-label">Plateforme</span>
            <div className="filter-chips">
              {PLATEFORMES.map((source) => (
                <Bascule
                  key={source}
                  actif={edition.sources.includes(source)}
                  onChange={() => bascule('sources', source)}
                >
                  <i className="alert-puce" style={{ background: SOURCE_COLORS[source] }} />
                  {SOURCE_LABELS[source]}
                </Bascule>
              ))}
            </div>
            <span className="muted alert-aide">Aucune cochée = toutes les plateformes.</span>
          </div>

          <div className="filter-group">
            <span className="filter-label">Publiée depuis moins de</span>
            <div className="filter-chips">
              <Bascule
                actif={!edition.maxAgeValue}
                onChange={() => set('maxAgeValue', 0)}
              >
                Peu importe
              </Bascule>
              {PRESETS_FRAICHEUR.map((preset) => (
                <Bascule
                  key={preset.label}
                  actif={
                    Number(edition.maxAgeValue) === preset.value &&
                    edition.maxAgeUnit === preset.unit
                  }
                  onChange={() =>
                    setEdition((e) => ({ ...e, maxAgeValue: preset.value, maxAgeUnit: preset.unit }))
                  }
                >
                  {preset.label}
                </Bascule>
              ))}
              <span className="filter-custom">
                <input
                  className="input input-num"
                  type="number"
                  min="0"
                  value={edition.maxAgeValue || ''}
                  placeholder="—"
                  onChange={(e) => set('maxAgeValue', Number(e.target.value) || 0)}
                />
                <select
                  className="input"
                  value={edition.maxAgeUnit}
                  onChange={(e) => set('maxAgeUnit', e.target.value)}
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

          <div className="filter-group">
            <span className="filter-label">Au plus</span>
            <div className="filter-chips">
              <Bascule
                actif={edition.maxApplicants === null}
                onChange={() => set('maxApplicants', null)}
              >
                Peu importe
              </Bascule>
              {[5, 10, 25, 50].map((seuil) => (
                <Bascule
                  key={seuil}
                  actif={edition.maxApplicants === seuil}
                  onChange={() => set('maxApplicants', seuil)}
                >
                  {seuil} candidats
                </Bascule>
              ))}
              <input
                className="input input-num"
                type="number"
                min="0"
                value={edition.maxApplicants ?? ''}
                placeholder="—"
                onChange={(e) =>
                  set('maxApplicants', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </div>
          </div>

          <div className="alert-reglages">
            <div className="filter-group">
              <span className="filter-label">Canaux</span>
              <div className="filter-chips">
                <Bascule
                  actif={edition.email}
                  onChange={(v) => set('email', v)}
                  titre={channels.email ? '' : 'SMTP non configuré : rien ne partira.'}
                >
                  Courriel
                </Bascule>
                <Bascule
                  actif={edition.push}
                  onChange={(v) => set('push', v)}
                  disabled={!channels.push}
                  titre={channels.push ? '' : 'Clés VAPID absentes côté serveur.'}
                >
                  Notification
                </Bascule>
              </div>
            </div>

            <div className="filter-group">
              <span className="filter-label">Fréquence</span>
              <div className="filter-chips">
                {RYTHMES.map((rythme) => (
                  <Bascule
                    key={rythme.cron}
                    actif={edition.cron === rythme.cron}
                    onChange={() => set('cron', rythme.cron)}
                  >
                    {rythme.label}
                  </Bascule>
                ))}
                <input
                  className="input input-cron"
                  value={edition.cron}
                  onChange={(e) => set('cron', e.target.value)}
                  title="Expression cron"
                  style={rythmeConnu ? undefined : { borderColor: 'var(--accent)' }}
                />
              </div>
            </div>

            <div className="filter-group">
              <span className="filter-label">S'arrête le</span>
              <div className="filter-chips">
                <input
                  className="input"
                  type="date"
                  value={edition.expiresAt || ''}
                  onChange={(e) => set('expiresAt', e.target.value)}
                />
                {edition.expiresAt && (
                  <button className="btn btn-ghost btn-sm" onClick={() => set('expiresAt', '')}>
                    Sans échéance
                  </button>
                )}
              </div>
            </div>
          </div>

          {apercu && (
            <div className="alert-apercu">
              <strong>
                {apercu.matched} candidature{apercu.matched > 1 ? 's' : ''}{' '}
                {apercu.matched > 1 ? 'correspondent' : 'correspond'} aujourd'hui
              </strong>
              {apercu.sample.map((item) => (
                <span key={item._id} className="alert-apercu-ligne">
                  <em style={{ color: STATUS_META[item.status]?.color }}>
                    {STATUS_META[item.status]?.label || item.status}
                  </em>
                  {item.title}
                  {item.company ? ` — ${item.company}` : ''}
                </span>
              ))}
              {apercu.matched > apercu.sample.length && (
                <span className="muted">… et {apercu.matched - apercu.sample.length} autres.</span>
              )}
            </div>
          )}

          <div className="card-foot">
            <button className="btn btn-primary btn-sm" onClick={enregistrer} disabled={occupe}>
              {occupe ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {edition._id && (
              <button className="btn btn-sm" onClick={voirApercu} disabled={occupe}>
                Voir ce que ça donne
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setEdition(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* --- Liste --- */}
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : alerts.length === 0 ? (
        <div className="empty">
          <strong>Aucune alerte</strong>
          Crée-en une pour être prévenu quand des candidatures changent d'état, quand un envoi
          échoue, ou quand une offre fraîche arrive sur une plateforme donnée.
        </div>
      ) : (
        <div className="alert-liste">
          {alerts.map((alerte) => (
            <div key={alerte._id} className={'panel alert-carte' + (alerte.enabled ? '' : ' pause')}>
              <div className="alert-carte-tete">
                <div>
                  <strong>{alerte.name}</strong>
                  <span className="muted">
                    {RYTHMES.find((r) => r.cron === alerte.cron)?.label || alerte.cron}
                    {' · '}
                    {[alerte.email && 'courriel', alerte.push && 'notification']
                      .filter(Boolean)
                      .join(' + ') || 'aucun canal'}
                  </span>
                </div>
                <span className={'badge' + (alerte.enabled ? '' : ' muted')}>
                  {alerte.enabled ? 'Active' : 'En pause'}
                </span>
              </div>

              <div className="alert-carte-criteres">
                {alerte.q && <em>« {alerte.q} »</em>}
                {alerte.statuses?.map((s) => (
                  <em key={s} style={{ color: STATUS_META[s]?.color }}>
                    {STATUS_META[s]?.label || s}
                  </em>
                ))}
                {alerte.sources?.map((s) => (
                  <em key={s}>{SOURCE_LABELS[s] || s}</em>
                ))}
                {alerte.maxAgeValue > 0 && (
                  <em>
                    &lt; {alerte.maxAgeValue}{' '}
                    {UNITES.find((u) => u.key === alerte.maxAgeUnit)?.label}
                  </em>
                )}
                {alerte.maxApplicants !== null && <em>≤ {alerte.maxApplicants} candidats</em>}
                {alerte.expiresAt && (
                  <em>jusqu'au {new Date(alerte.expiresAt).toLocaleDateString('fr-FR')}</em>
                )}
              </div>

              {(alerte.lastResult || alerte.lastError) && (
                <div className={'alert-bilan' + (alerte.lastError ? ' erreur' : '')}>
                  {alerte.lastError || alerte.lastResult}
                  {alerte.lastRunAt && (
                    <span className="muted">
                      {' · '}
                      {new Date(alerte.lastRunAt).toLocaleString('fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  )}
                </div>
              )}

              <div className="card-foot">
                <button className="btn btn-sm" onClick={() => ouvrir(alerte)}>
                  Régler
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await api.alerts.run(alerte._id).catch((e) => setErreur(e.message));
                    load();
                  }}
                >
                  Déclencher
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => supprimer(alerte)}>
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
