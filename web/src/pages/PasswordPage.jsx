import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

/**
 * Mot de passe oublié — les deux moitiés du parcours dans une seule page.
 *
 * Sans jeton dans l'URL, on demande l'adresse ; avec un jeton, on demande le
 * nouveau mot de passe. Une seule route, parce que c'est un seul parcours : la
 * personne arrive ici par le lien du courriel sans savoir qu'elle change d'étape.
 */
export default function PasswordPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  const demander = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api.auth.forgotPassword(email);
      setEnvoye(true);
      if (!res.mailer) {
        toast.info(
          "Aucun serveur d'envoi n'est configuré : le lien se trouve dans les journaux du serveur.",
          { duration: 9000 }
        );
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reinitialiser = async (event) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast.error('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await api.auth.resetPassword(token, password);
      toast.success('Mot de passe modifié. Tu peux te connecter.');
      navigate('/');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>{token ? 'Nouveau mot de passe' : 'Mot de passe oublié'}</h1>

        {token ? (
          <form onSubmit={reinitialiser}>
            <p className="muted">Choisis un mot de passe d&apos;au moins 10 caractères.</p>

            <div className="field">
              <label>Nouveau mot de passe</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label>Confirmer</label>
              <input
                className="input"
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy}>
              Modifier le mot de passe
            </button>
          </form>
        ) : envoye ? (
          /*
           * Le message ne dit jamais si l'adresse existe.
           *
           * Répondre « compte inconnu » transformerait cette page en outil
           * d'énumération : on saurait, sans mot de passe, qui a un compte ici.
           */
          <p className="muted">
            Si un compte existe pour <strong>{email}</strong>, un lien vient d&apos;y être envoyé.
            Il expire dans une heure.
          </p>
        ) : (
          <form onSubmit={demander}>
            <p className="muted">
              Indique ton adresse : nous t&apos;enverrons un lien pour choisir un nouveau mot de
              passe.
            </p>

            <div className="field">
              <label>Adresse e-mail</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy}>
              Envoyer le lien
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link className="back-link" to="/">
            ← Revenir à la connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
