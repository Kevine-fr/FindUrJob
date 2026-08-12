import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from './Toast.jsx';

/**
 * Reprise en main d'une connexion.
 *
 * Quand la connexion automatique bute — 2FA, captcha, formulaire inattendu —
 * on n'insiste pas : on affiche l'écran du navigateur piloté et l'utilisateur
 * termine lui-même. La session obtenue vit dans le profil que le robot
 * réutilisera, donc elle compte vraiment.
 *
 * C'est la plateforme qui confirme, pas l'utilisateur : « J'ai terminé »
 * déclenche une vérification côté serveur.
 */
export default function ManualLogin({ platform, label, vncUrl, onDone, onClose }) {
  const toast = useToast();
  const [opening, setOpening] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

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

  // Échap ferme, et le fond ne défile plus derrière la fenêtre.
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const confirm = async () => {
    setChecking(true);
    try {
      const { connected } = await api.accounts.checkManual(platform);
      if (connected) {
        toast.success(`Session ${label} ouverte.`);
        onDone();
      } else {
        toast.error(
          `${label} ne reconnaît pas encore de session. Termine la connexion dans la fenêtre, puis réessaie.`
        );
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Connexion manuelle ${label}`}>
        <header className="modal-head">
          <div>
            <h2>Connexion manuelle — {label}</h2>
            <p className="muted">
              Connecte-toi dans la fenêtre ci-dessous, 2FA comprise. La session restera ouverte
              pour les prochaines recherches et candidatures.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-body">
          {error ? (
            <div className="callout callout-warn">
              <span>⚠</span>
              <div>{error}</div>
            </div>
          ) : opening ? (
            <div className="skeleton" style={{ height: '100%', minHeight: 380 }} />
          ) : (
            <iframe
              className="vnc-frame"
              title={`Navigateur ${label}`}
              src={`${vncUrl}/vnc.html?autoconnect=1&resize=remote&reconnect=1`}
            />
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted" style={{ fontSize: 12.5 }}>
            Le robot ne franchit jamais une vérification à ta place.
          </span>
          <div className="inline">
            <button className="btn btn-sm" onClick={onClose}>
              Annuler
            </button>
            <button
              className={`btn btn-primary btn-sm${checking ? ' is-busy' : ''}`}
              onClick={confirm}
              disabled={checking || opening || Boolean(error)}
            >
              J'ai terminé
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
