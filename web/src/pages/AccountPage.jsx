import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ilYA } from '../lib/freshness.js';

/**
 * L'espace compte : identité, adresse, mot de passe, suppression.
 *
 * Volontairement séparé de « Mon CV » — l'un porte la candidature, l'autre le
 * compte lui-même. Les mélanger rendrait la suppression du compte trop facile à
 * déclencher par mégarde, au milieu de réglages anodins.
 */
export default function AccountPage() {
  const toast = useToast();
  const { user, refresh, logout } = useAuth();

  const [nom, setNom] = useState(user?.fullName || '');
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    api.version().then(setVersion).catch(() => setVersion(null));
  }, []);

  const enregistrerNom = async () => {
    setBusy(true);
    try {
      await api.auth.update({ fullName: nom });
      await refresh();
      toast.success('Profil mis à jour.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const renvoyerVerification = async () => {
    setBusy(true);
    try {
      const res = await api.auth.sendVerification();
      if (res.alreadyVerified) toast.info('Ton adresse est déjà confirmée.');
      else if (res.sent) toast.success('Courriel de confirmation envoyé.');
      else
        toast.error(
          "Aucun serveur d'envoi configuré : le lien est écrit dans les journaux du serveur.",
          { title: 'Courriel non envoyé', duration: 9000 }
        );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const changerMotDePasse = async () => {
    if (nouveau !== confirmation) {
      toast.error('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await api.auth.changePassword(actuel, nouveau);
      setActuel('');
      setNouveau('');
      setConfirmation('');
      toast.success('Mot de passe modifié.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimer = async () => {
    /*
     * Deux confirmations, dont une frappe.
     *
     * La suppression emporte offres, candidatures et CV : un clic accidentel
     * ne se rattrape pas. Retaper son adresse coûte cinq secondes et rend
     * l'erreur pratiquement impossible.
     */
    const saisie = window.prompt(
      'Cette action est définitive.\n\n' +
        'Toutes tes offres, candidatures et CV seront effacés.\n\n' +
        `Retape ton adresse (${user.email}) pour confirmer :`
    );
    if (!saisie || saisie.trim().toLowerCase() !== user.email) {
      if (saisie !== null) toast.error('Adresse incorrecte : suppression annulée.');
      return;
    }

    const motDePasse = window.prompt('Ton mot de passe, pour finir :') || '';

    setBusy(true);
    try {
      await api.auth.remove({ password: motDePasse, confirmEmail: saisie });
      toast.success('Compte supprimé.');
      await logout();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mon compte</h1>
          <p>Ton identité, ton accès et la suppression de tes données.</p>
        </div>
      </div>

      <div className="grid admin-grid">
        {/* ---- Identité ---- */}
        <div className="panel">
          <h2>Identité</h2>

          <div className="field">
            <label>Nom complet</label>
            <input
              className="input"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Ton nom, tel qu'il apparaît sur le CV"
            />
          </div>

          <div className="field">
            <label>Adresse e-mail</label>
            <div className="inline" style={{ gap: 9 }}>
              <input className="input" value={user.email} readOnly style={{ flex: 1 }} />
              <span className={`badge dot${user.emailVerified ? ' badge-send' : ''}`}>
                {user.emailVerified ? 'Confirmée' : 'Non confirmée'}
              </span>
            </div>
            {!user.emailVerified && (
              <span className="filter-hint">
                Confirmer ton adresse permet de récupérer ton compte si tu perds ton mot de passe.
              </span>
            )}
          </div>

          <div className="inline">
            <button className="btn btn-primary btn-sm" onClick={enregistrerNom} disabled={busy}>
              Enregistrer
            </button>
            {!user.emailVerified && (
              <button className="btn btn-sm" onClick={renvoyerVerification} disabled={busy}>
                Envoyer le lien de confirmation
              </button>
            )}
          </div>

          <div className="section-label">Repères</div>
          <dl className="facts">
            <div>
              <dt>Rôle</dt>
              <dd>{user.role === 'admin' ? 'Administrateur' : 'Membre'}</dd>
            </div>
            <div>
              <dt>Compte créé</dt>
              <dd>{ilYA(user.createdAt) || '—'}</dd>
            </div>
            <div>
              <dt>Dernière connexion</dt>
              <dd>{ilYA(user.lastLoginAt) || '—'}</dd>
            </div>
          </dl>
        </div>

        {/* ---- Mot de passe ---- */}
        <div className="panel">
          <h2>Mot de passe</h2>

          <div className="field">
            <label>Mot de passe actuel</label>
            <input
              className="input"
              type="password"
              value={actuel}
              onChange={(e) => setActuel(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="field">
            <label>Nouveau mot de passe</label>
            <input
              className="input"
              type="password"
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              autoComplete="new-password"
              placeholder="10 caractères minimum"
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
            />
          </div>

          <button
            className="btn btn-primary btn-sm"
            onClick={changerMotDePasse}
            disabled={busy || !nouveau}
          >
            Modifier le mot de passe
          </button>
        </div>

        {/* ---- Version ---- */}
        <div className="panel">
          <h2>Version</h2>
          {version ? (
            <dl className="facts">
              <div>
                <dt>Application</dt>
                <dd className="row">
                  <span className="chip chip-accent">v{version.version}</span>
                  {/* Une version de repli n'est pas une version livrée : le
                      dire évite de lire un numéro figé comme un numéro à jour. */}
                  {!version.deployed && (
                    <span
                      className="chip"
                      title="Numéro du package.json : aucune livraison n'a nommé cette version."
                    >
                      développement
                    </span>
                  )}
                </dd>
              </div>
              {version.commit && (
                <div>
                  <dt>Révision</dt>
                  <dd>
                    <code>{version.commit}</code>
                  </dd>
                </div>
              )}
              {version.builtAt && (
                <div>
                  <dt>Déployée</dt>
                  <dd>{ilYA(version.builtAt) || version.builtAt}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Version indisponible.
            </p>
          )}
        </div>

        {/* ---- Zone de danger ---- */}
        <div className="panel danger-zone">
          <h2>Supprimer le compte</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
            Efface définitivement ton compte et tout ce qui lui appartient : offres collectées,
            candidatures, CV générés, sessions plateformes. Rien n'est conservé, rien n'est
            récupérable.
          </p>
          <button className="btn btn-danger btn-sm" onClick={supprimer} disabled={busy}>
            Supprimer définitivement mon compte
          </button>
        </div>
      </div>
    </>
  );
}
