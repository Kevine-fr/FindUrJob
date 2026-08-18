import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';

/**
 * Confirmation d'adresse, atteinte par le lien du courriel.
 *
 * La page ne demande rien : elle joue le jeton et annonce le résultat. Ajouter
 * un bouton « Confirmer » n'apporterait rien — la personne a déjà cliqué dans
 * son courriel, c'est là qu'était l'intention.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [etat, setEtat] = useState('en-cours'); // en-cours | ok | echec
  const [message, setMessage] = useState('');

  // React 18 monte deux fois en développement : sans ce garde, le jeton — qui
  // est à usage unique — serait consommé par le premier appel et le second
  // afficherait un échec sur une confirmation pourtant réussie.
  const lance = useRef(false);

  useEffect(() => {
    if (lance.current) return;
    lance.current = true;

    if (!token) {
      setEtat('echec');
      setMessage('Lien incomplet : aucun jeton de confirmation.');
      return;
    }

    api.auth
      .verifyEmail(token)
      .then(() => setEtat('ok'))
      .catch((e) => {
        setEtat('echec');
        setMessage(e.message);
      });
  }, [token]);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Confirmation de l&apos;adresse</h1>

        {etat === 'en-cours' && <p className="muted">Vérification en cours…</p>}

        {etat === 'ok' && (
          <>
            <p>
              Ton adresse est confirmée. Tu peux maintenant récupérer ton compte par courriel si tu
              perds ton mot de passe.
            </p>
            <Link className="btn btn-primary btn-block" to="/">
              Continuer
            </Link>
          </>
        )}

        {etat === 'echec' && (
          <>
            <p className="muted">{message}</p>
            <p className="muted">
              Les liens expirent au bout de 24 heures. Demande-en un nouveau depuis la page « Mon
              compte ».
            </p>
            <Link className="btn btn-block" to="/">
              Revenir
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
