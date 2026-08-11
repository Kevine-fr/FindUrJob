import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

const PLATFORMS = {
  linkedin: { label: 'LinkedIn', color: '#0a66c2', short: 'in' },
  indeed: { label: 'Indeed', color: '#2557a7', short: 'id' },
  hellowork: { label: 'HelloWork', color: '#e5484d', short: 'hw' },
};

const STATE_LABELS = {
  connectee: 'Session ouverte',
  expiree: 'Session expirée',
  verification: 'Vérification requise',
  erreur: 'Erreur',
  absente: 'Pas de session',
};

function AccountCard({ account, onSaved, onChanged }) {
  const toast = useToast();
  const meta = PLATFORMS[account.platform];

  const [email, setEmail] = useState(account.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (label, work) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(`${label} : ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run('Enregistrement', async () => {
      const saved = await api.accounts.save(account.platform, {
        email,
        ...(password ? { password } : {}),
      });
      setPassword('');
      onSaved(saved);
      toast.success(`Identifiants ${meta.label} enregistrés (chiffrés).`);
    });

  const connect = () =>
    run('Connexion', async () => {
      const result = await api.accounts.login(account.platform, password || undefined);
      setPassword('');
      onChanged();

      if (result.status === 'connected') {
        toast.success(result.message || `Session ${meta.label} ouverte.`);
      } else if (result.status === 'verification') {
        toast.info(result.message, { title: `${meta.label} — vérification`, duration: 12000 });
      } else {
        toast.error(result.message || 'Connexion refusée.');
      }
    });

  const disconnect = () =>
    run('Déconnexion', async () => {
      await api.accounts.logout(account.platform);
      onChanged();
      toast.success(`Session ${meta.label} fermée.`);
    });

  const forget = () =>
    run('Suppression', async () => {
      await api.accounts.remove(account.platform);
      onChanged();
      toast.success(`Identifiants ${meta.label} effacés.`);
    });

  return (
    <div className="card account-card">
      <div className="account-head">
        <span className="account-logo" style={{ background: meta.color }}>
          {meta.short}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{meta.label}</h3>
          <span className={`state state-${account.sessionState}`}>
            {STATE_LABELS[account.sessionState] || account.sessionState}
          </span>
        </div>
      </div>

      {account.lastMessage && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {account.lastMessage}
        </p>
      )}

      <div className="field" style={{ marginBottom: 0 }}>
        <label>Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={`Ton identifiant ${meta.label}`}
          autoComplete="off"
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>
          Mot de passe{' '}
          {account.hasPassword && (
            <span className="muted" style={{ fontWeight: 400 }}>
              — déjà enregistré, laisse vide pour le garder
            </span>
          )}
        </label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={account.hasPassword ? '••••••••' : 'Chiffré avant enregistrement'}
          autoComplete="new-password"
        />
      </div>

      <div className="inline">
        <button className={`btn btn-sm${busy ? ' is-busy' : ''}`} onClick={save} disabled={busy}>
          Enregistrer
        </button>
        <button
          className={`btn btn-primary btn-sm${busy ? ' is-busy' : ''}`}
          onClick={connect}
          disabled={busy || !email}
        >
          Ouvrir la session
        </button>
        {account.sessionState === 'connectee' && (
          <button className="btn btn-sm" onClick={disconnect} disabled={busy}>
            Fermer
          </button>
        )}
        {(account.hasPassword || account.email) && (
          <button className="btn btn-danger btn-sm" onClick={forget} disabled={busy}>
            Oublier
          </button>
        )}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.accounts
      .list()
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const patchAccount = (saved) =>
    setData((current) => ({
      ...current,
      accounts: current.accounts.map((item) =>
        item.platform === saved.platform ? saved : item
      ),
    }));

  if (error) {
    return (
      <div className="empty">
        <strong>Comptes indisponibles</strong>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cards">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton skeleton-card" style={{ height: 300 }} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comptes</h1>
          <p>
            Ces plateformes n'ont pas d'API : FindUrJob s'y connecte dans un vrai navigateur, avec
            tes identifiants, pour lire les offres et candidater en ton nom.
          </p>
        </div>
      </div>

      {!data.vaultReady && (
        <div className="callout callout-warn">
          <span>⚠</span>
          <div>
            <strong>Aucune clé de chiffrement configurée.</strong> Tant que{' '}
            <code>CREDENTIALS_KEY</code> n'est pas définie, aucun mot de passe ne peut être
            enregistré. Génère-la avec <code>openssl rand -hex 32</code>, mets-la dans{' '}
            <code>server/.env</code>, puis redémarre le serveur.
          </div>
        </div>
      )}

      {data.botError && (
        <div className="callout callout-warn">
          <span>⚠</span>
          <div>
            Le navigateur piloté ne répond pas : {data.botError}. Les états de session affichés
            sont ceux du dernier contrôle.
          </div>
        </div>
      )}

      <div className="callout callout-info">
        <span>ℹ</span>
        <div>
          Les mots de passe sont chiffrés (AES-256-GCM) avec une clé qui vit hors de la base, et ne
          sont jamais renvoyés à cette page. Si la plateforme demande une 2FA ou un captcha, c'est à
          toi de la valider : le bot ne cherche jamais à la contourner.
        </div>
      </div>

      <div className="grid grid-cards stagger">
        {data.accounts.map((account, index) => (
          <div key={account.platform} style={{ '--i': index }}>
            <AccountCard account={account} onSaved={patchAccount} onChanged={load} />
          </div>
        ))}
      </div>
    </>
  );
}
