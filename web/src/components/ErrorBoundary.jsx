import { Component } from 'react';

/*
 * Le filet qui empêche une erreur d'effacer l'application.
 *
 * React ne rattrape rien à l'intérieur d'un rendu ni d'un setter d'état :
 * la moindre exception y démonte l'arbre entier, et il ne reste qu'une page
 * vide. C'est ce qu'on a vu après « Relancer l'envoi » — un `undefined._id`
 * dans un `setState`, et l'écran devenait noir, sans message, sans retour
 * possible autre que recharger à la main.
 *
 * La cause de ce jour-là est corrigée. Ce filet couvre les suivantes : une
 * fiche à laquelle il manque un champ, une réponse du serveur d'une forme
 * inattendue, une propriété lue sur un objet absent. Aucune ne mérite de
 * faire disparaître toute la plateforme, et surtout aucune ne doit laisser
 * la personne devant du vide sans savoir quoi faire.
 *
 * On garde le message de l'erreur à l'écran : sans lui, il faudrait ouvrir la
 * console du navigateur pour avoir la moindre chance de la signaler.
 */
export default class ErrorBoundary extends Component {
  state = { erreur: null };

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidCatch(erreur, infos) {
    // La trace des composants dit *où*, ce que le message seul ne dit jamais.
    console.error('Rendu interrompu :', erreur, infos?.componentStack);
  }

  render() {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;

    return (
      <div className="empty" style={{ margin: 24 }}>
        <strong>Cette page s’est interrompue</strong>
        <p style={{ marginTop: 4 }}>
          Le reste de la plateforme fonctionne : reviens en arrière, ou recharge.
        </p>
        <p className="meta" style={{ marginTop: 10, wordBreak: 'break-word' }}>
          {erreur?.message || String(erreur)}
        </p>
        <div className="inline" style={{ marginTop: 16, justifyContent: 'center' }}>
          {/*
           * Repartir de l'état affiché plutôt que de recharger : la navigation
           * précédente est souvent saine, et un rechargement ferait perdre au
           * passage les filtres et la page en cours.
           */}
          <button className="btn btn-sm" onClick={() => this.setState({ erreur: null })}>
            Réessayer
          </button>
          <button className="btn btn-sm" onClick={() => window.location.assign('/')}>
            Revenir à l’accueil
          </button>
        </div>
      </div>
    );
  }
}
