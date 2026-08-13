import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from './Toast.jsx';

/**
 * Adresse complète de l'écran du navigateur piloté.
 *
 * noVNC ne déduit pas l'adresse du websocket du dossier de la page : il vise
 * toujours `<hôte>/websockify` à la racine. Derrière un proxy qui sert
 * l'écran sous /vnc, il faut donc lui donner le chemin explicitement, sinon
 * l'interface s'affiche et la connexion échoue.
 */
export function vncViewerUrl(vncUrl) {
  const base = String(vncUrl || '').replace(/\/+$/, '');
  if (!base) return '';

  // Base absolue (dev, port publié) : l'écran est à la racine de son origine.
  // Base relative (prod, /vnc) : le chemin du websocket doit porter le préfixe.
  const prefix = /^https?:\/\//i.test(base) ? '' : `${base.replace(/^\/+/, '')}/`;

  const params = new URLSearchParams({
    autoconnect: '1',
    reconnect: '1',
    resize: 'remote',
    path: `${prefix}websockify`,
  });
  return `${base}/vnc.html?${params}`;
}

/**
 * Reprise en main d'une connexion.
 *
 * L'écran s'ouvre dans un onglet à part, et non dans un cadre : le navigateur
 * distant a besoin de place, et un onglet évite les restrictions d'iframe.
 *
 * Point important : c'est le navigateur *du robot* qu'on pilote, pas le tien.
 * Se connecter à la plateforme dans ton propre navigateur ne servirait à rien —
 * la session naîtrait chez toi, là où le robot ne peut pas la lire.
 */
export default function ManualLogin({ platform, label, vncUrl, onDone, onClose }) {
  const toast = useToast();
  const [opening, setOpening] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const viewer = vncViewerUrl(vncUrl);

  // On prépare la page de connexion côté robot dès l'ouverture : quand
  // l'utilisateur bascule sur l'onglet, la plateforme est déjà chargée.
  useEffect(() => {
    let cancelled = false;
    api.accounts
      .openManual(platform)
      .then(() => !cancelled && setOpening(false))
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setOpening(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [google, setGoogle] = useState(null);

  const confirm = async () => {
    setChecking(true);
    try {
      const result = await api.accounts.checkManual(platform);
      setGoogle(result.google ?? null);

      if (result.connected) {
        toast.success(`Session ${label} ouverte.`);
        onDone();
      } else {
        toast.error(
          `${label} ne reconnaît pas encore de session. Termine la connexion dans l'onglet, puis réessaie.`
        );
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  };

  /** Ouvre Google ou Gmail dans le navigateur *de cette plateforme*. */
  const openHelper = async (target, name) => {
    try {
      await api.accounts.openManual(platform, target);
      toast.info(`${name} ouvert dans le navigateur du robot — bascule sur l'onglet.`, {
        duration: 7000,
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div
      className="modal-scrim"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal modal-sm" role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>Connexion manuelle — {label}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-body modal-body-text">
          <ol className="steps">
            <li>
              <strong>Ouvre le navigateur du robot</strong> — un onglet s'ouvre sur la page de
              connexion {label}.
            </li>
            <li>
              <strong>Connecte-toi normalement</strong>, 2FA ou captcha compris.
            </li>
            <li>
              <strong>Reviens ici</strong> et clique sur « J'ai terminé » : {label} confirmera
              elle-même que la session est bien ouverte.
            </li>
          </ol>

          {error ? (
            <div className="callout callout-warn" style={{ marginBottom: 0 }}>
              <span>⚠</span>
              <div>{error}</div>
            </div>
          ) : (
            <a
              className={`btn btn-primary btn-block${opening ? ' is-busy' : ''}`}
              href={viewer || undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={opening || !viewer}
              onClick={(event) => (opening || !viewer) && event.preventDefault()}
            >
              Ouvrir le navigateur du robot ↗
            </a>
          )}

          <div className="helper-box">
            <div className="helper-head">
              <strong>Coup de pouce Google</strong>
              {google !== null && (
                <span className={`state state-${google ? 'connectee' : 'absente'}`}>
                  {google ? 'Session Google ouverte' : 'Pas de session Google'}
                </span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
              Ouverts dans le navigateur de {label} : la session Google y devient utilisable par
              son bouton « Se connecter avec Google », et Gmail sert à relever un code de
              vérification sans changer de fenêtre.
            </p>
            <div className="inline">
              <button
                className="btn btn-sm"
                onClick={() => openHelper('google', 'Google')}
                disabled={opening || Boolean(error)}
              >
                Se connecter à Google
              </button>
              <button
                className="btn btn-sm"
                onClick={() => openHelper('gmail', 'Gmail')}
                disabled={opening || Boolean(error)}
              >
                Ouvrir Gmail
              </button>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            C'est le navigateur du robot que tu pilotes : la session s'enregistre là où il en a
            besoin. Te connecter dans ton propre navigateur ne lui servirait à rien.
          </p>
        </div>

        <footer className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>
            Annuler
          </button>
          <button
            className={`btn btn-primary btn-sm${checking ? ' is-busy' : ''}`}
            onClick={confirm}
            disabled={checking || Boolean(error)}
          >
            J'ai terminé
          </button>
        </footer>
      </div>
    </div>
  );
}
