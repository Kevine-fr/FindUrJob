import { useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from './Toast.jsx';

/**
 * L'automatisation des deux gestes d'entretien.
 *
 * Ils sont réglés séparément, et ce n'est pas un détail : la vérification ne
 * fait que **lire** ce que les plateformes déclarent, la relance **envoie** des
 * candidatures. Les mettre sous un même interrupteur reviendrait à faire
 * accepter le second en acceptant le premier.
 */

/** Quelques rythmes courants, plutôt qu'une expression cron à écrire. */
const RYTHMES = [
  { valeur: '0 8 * * *', libelle: 'Chaque matin (8 h)' },
  { valeur: '0 8,18 * * *', libelle: 'Matin et soir' },
  { valeur: '0 8 * * 1-5', libelle: 'En semaine (8 h)' },
  { valeur: '0 9 * * 1', libelle: 'Chaque lundi (9 h)' },
];

function Travail({ titre, aide, etat, onChange }) {
  return (
    <div className="entretien-travail">
      <label className="entretien-bascule">
        <input
          type="checkbox"
          checked={Boolean(etat?.enabled)}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <span>
          <strong>{titre}</strong>
          <span className="muted"> — {aide}</span>
        </span>
      </label>

      {etat?.enabled && (
        <select
          className="select"
          value={RYTHMES.some((r) => r.valeur === etat.cron) ? etat.cron : ''}
          onChange={(e) => onChange({ cron: e.target.value })}
        >
          {RYTHMES.map((r) => (
            <option key={r.valeur} value={r.valeur}>
              {r.libelle}
            </option>
          ))}
          {!RYTHMES.some((r) => r.valeur === etat.cron) && (
            <option value="">Rythme personnalisé ({etat.cron})</option>
          )}
        </select>
      )}

      {etat?.lastAt && (
        <p className="muted entretien-bilan">
          Dernière fois : {new Date(etat.lastAt).toLocaleString('fr-FR')} — {etat.lastResult}
        </p>
      )}
    </div>
  );
}

export default function Entretien({ etat, ouvert, onFermer, onRegle }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const enregistrer = async (patch) => {
    setBusy(true);
    try {
      onRegle(await api.upkeep.update(patch));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // L'avancement s'affiche même quand le panneau est replié : c'est pendant que
  // ça tourne qu'on veut savoir où ça en est, pas quand on règle le rythme.
  const enCours = etat?.retry?.running ? etat.retry : etat?.verify?.running ? etat.verify : null;

  return (
    <>
      {enCours && (
        <div className="map-notice entretien-progres">
          <span>
            {etat?.retry?.running ? 'Relance' : 'Vérification'} en cours
            {enCours.total ? ` — ${enCours.done}/${enCours.total}` : ''}
            {enCours.step ? ` · ${enCours.step}` : ''}
          </span>
          {enCours.total > 0 && (
            <span className="entretien-jauge">
              <span style={{ width: `${Math.round((enCours.done / enCours.total) * 100)}%` }} />
            </span>
          )}
        </div>
      )}

      {ouvert && (
        <div className={`panel entretien${busy ? ' is-busy' : ''}`}>
          <div className="relance-head">
            <div>
              <h2>Entretien automatique</h2>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
                Ce que FindUrJob fait tout seul, à ta place et à ton rythme.
              </p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onFermer}>
              Fermer
            </button>
          </div>

          <Travail
            titre="Vérifier auprès des plateformes"
            aide="lit ce qu'elles déclarent avoir reçu, n'envoie rien"
            etat={etat?.verify}
            onChange={(v) => enregistrer({ verify: v })}
          />

          <Travail
            titre="Relancer les candidatures"
            aide="renvoie ce qui n'a pas abouti — des candidatures partent vraiment"
            etat={etat?.retry}
            onChange={(v) => enregistrer({ retry: v })}
          />

          {etat?.retry?.enabled && (
            <label className="field entretien-plafond">
              <span>Au plus, par passage</span>
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                value={etat.retryMax ?? 10}
                onChange={(e) => enregistrer({ retryMax: Number(e.target.value) })}
              />
              <span className="muted">
                Chaque relance ouvre un navigateur : sans plafond, une passe nocturne
                tournerait des heures.
              </span>
            </label>
          )}
        </div>
      )}
    </>
  );
}
