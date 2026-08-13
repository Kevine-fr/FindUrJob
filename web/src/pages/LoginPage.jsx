import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../components/Toast.jsx';

const MIN_PASSWORD = 10;

/**
 * Connexion et création de compte, sur le même écran.
 *
 * Au tout premier démarrage, aucun compte n'existe : on bascule d'office sur
 * l'inscription et on annonce que ce compte sera administrateur — sans quoi
 * personne ne saurait pourquoi le formulaire de connexion refuse tout.
 */
export default function LoginPage() {
  const { login, register, setupNeeded } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState(setupNeeded ? 'inscription' : 'connexion');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);

  const inscription = mode === 'inscription';
  const tropCourt = inscription && password.length > 0 && password.length < MIN_PASSWORD;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (inscription) {
        await register({ email, password, fullName });
        toast.success(setupNeeded ? 'Compte administrateur créé.' : 'Bienvenue !');
      } else {
        await login(email, password);
        toast.success('Content de te revoir.');
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card animate-in">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width="34" height="34" />
          <span>
            FindUr<span>Job</span>
          </span>
        </div>

        <h1>{inscription ? 'Créer un compte' : 'Se connecter'}</h1>
        <p className="muted auth-intro">
          {setupNeeded
            ? "Première visite : ce compte sera l'administrateur de l'installation, et reprendra les données déjà présentes."
            : inscription
              ? 'Ton CV, tes offres et tes candidatures, rien qu’à toi.'
              : 'Reprends là où tu t’es arrêté.'}
        </p>

        <form onSubmit={submit}>
          {inscription && (
            <div className="field">
              <label htmlFor="nom">Nom (facultatif)</label>
              <input
                id="nom"
                className="input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Adresse e-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="mdp">Mot de passe</label>
            <input
              id="mdp"
              className="input"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={inscription ? 'new-password' : 'current-password'}
            />
            {inscription && (
              <span className="filter-hint" style={{ color: tropCourt ? 'var(--danger)' : undefined }}>
                {MIN_PASSWORD} caractères minimum
                {tropCourt ? ` — il en manque ${MIN_PASSWORD - password.length}` : ''}
              </span>
            )}
          </div>

          <button
            className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`}
            type="submit"
            disabled={busy || tropCourt}
          >
            {inscription ? 'Créer mon compte' : 'Se connecter'}
          </button>
        </form>

        {/* Pendant l'installation, il n'y a rien à quoi se connecter. */}
        {!setupNeeded && (
          <p className="auth-switch">
            {inscription ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setMode(inscription ? 'connexion' : 'inscription')}
            >
              {inscription ? 'Se connecter' : 'En créer un'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
