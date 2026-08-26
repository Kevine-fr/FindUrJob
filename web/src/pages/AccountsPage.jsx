import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import ManualLogin from '../components/ManualLogin.jsx';

/**
 * Une entrée par plateforme sur laquelle on sait candidater.
 *
 * `note` dit ce qui attend la personne : toutes ne se connectent pas de la
 * même façon, et le découvrir après trois échecs est décourageant.
 */
const PLATFORMS = {
  linkedin: { label: 'LinkedIn', color: '#0a66c2', short: 'in' },
  indeed: {
    label: 'Indeed',
    color: '#2557a7',
    short: 'id',
    note: 'Indeed bloque les connexions venues d’un serveur (protection Cloudflare). La reprise en main est souvent le seul chemin.',
  },
  hellowork: { label: 'HelloWork', color: '#e5484d', short: 'hw' },
  apec: { label: 'APEC', color: '#00857d', short: 'ap' },
  welcometothejungle: {
    label: 'Welcome to the Jungle',
    color: '#ffcd00',
    short: 'wt',
    note: 'Beaucoup d’annonces renvoient vers l’outil de recrutement de l’employeur : l’envoi automatique ne couvre que celles hébergées par WTTJ.',
  },
  francetravail: {
    label: 'France Travail',
    // France Travail n’identifie pas par e-mail mais par un identifiant
    // numérique. Un champ `type="email"` refusait la saisie côté navigateur :
    // la connexion enregistrée était donc impossible, seule la reprise en main
    // fonctionnait.
    identifiant: { label: 'Identifiant France Travail', type: 'text',
      aide: 'Ton identifiant numérique, pas une adresse e-mail.' },
    color: '#ec4a2c',
    short: 'ft',
    note: 'Enregistre ton identifiant et ton mot de passe : la session se rouvre alors toute seule quand elle expire. Si France Travail demande un code, la reprise en main prend le relais.',
  },
};

const INCONNUE = { label: '', color: '#6b7280', short: '??' };

const STATE_LABELS = {
  connectee: 'Session ouverte',
  expiree: 'Session expirée',
  verification: 'Vérification requise',
  erreur: 'Erreur',
  absente: 'Pas de session',
};

function AccountCard({ account, onSaved, onChanged, manualLogin, onManual }) {
  const toast = useToast();
  // Une plateforme ajoutée côté serveur ne doit pas faire écran blanc ici.
  const meta = PLATFORMS[account.platform] || {
    ...INCONNUE,
    label: account.platform,
    short: account.platform.slice(0, 2),
  };

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
        return;
      }

      // La connexion automatique n'a pas abouti. Plutôt que de s'acharner, on
      // propose de terminer à la main — c'est le seul moyen sûr face à une 2FA.
      toast.error(result.message || 'Connexion refusée.');
      if (manualLogin) {
        const proceed = window.confirm(
          `${meta.label} n'a pas validé la connexion automatique.\n\n` +
            `${result.message || ''}\n\n` +
            'Veux-tu terminer la connexion toi-même dans le navigateur piloté ?'
        );
        if (proceed) onManual();
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

      {/* Ce que la plateforme impose, dit avant l'échec plutôt qu'après. */}
      {meta.note && (
        <p className="account-note" style={{ fontSize: 13, margin: 0 }}>
          {meta.note}
        </p>
      )}

      {account.lastMessage && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {account.lastMessage}
        </p>
      )}

      <div className="field" style={{ marginBottom: 0 }}>
        <label>{meta.identifiant?.label || 'Email'}</label>
        <input
          className="input"
          type={meta.identifiant?.type || 'email'}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={meta.identifiant?.aide || `Ton identifiant ${meta.label}`}
          autoComplete="off"
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>
          Mot de passe{' '}
          {account.hasPassword ? (
            <span className="muted" style={{ fontWeight: 400 }}>
              — déjà enregistré, laisse vide pour le garder
            </span>
          ) : (
            /* Sans mot de passe enregistré, la veille n'a rien à rejouer : la
               session expirée reste fermée jusqu'à une reprise en main. Le dire
               ici évite de croire la reconnexion automatique active alors
               qu'elle ne peut pas l'être. */
            <span className="muted" style={{ fontWeight: 400 }}>
              — nécessaire pour que la session se rouvre toute seule
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
        {manualLogin && (
          <button className="btn btn-sm" onClick={onManual} disabled={busy}>
            Connexion manuelle
          </button>
        )}
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
  const [manual, setManual] = useState(null); // plateforme en reprise en main

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
            <AccountCard
              account={account}
              onSaved={patchAccount}
              onChanged={load}
              manualLogin={data.manualLogin && Boolean(data.vncUrl)}
              onManual={() => setManual(account.platform)}
            />
          </div>
        ))}
      </div>

      {manual && (
        <ManualLogin
          platform={manual}
          label={PLATFORMS[manual].label}
          vncUrl={data.vncUrl}
          onClose={() => setManual(null)}
          onDone={() => {
            setManual(null);
            load();
          }}
        />
      )}
    </>
  );
}
