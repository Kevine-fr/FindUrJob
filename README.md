# Filo — copilote de candidatures

_Nom provisoire, à renommer librement._

Filo prépare le gros du travail de candidature (agrégation d'offres, CV reciblé
par offre, lettre, suivi), **tu gardes la main sur l'envoi**. Pas de coffre à
mots de passe, pas de contournement d'anti-bot : voir « Principe de conception ».

Cette ossature contient le **backend Node/Express + Mongo** et le **front
React/Vite**. Le **moteur IA (Python)** se branchera ensuite sur une couture
unique déjà prévue.

## Arborescence

```
filo/
├── docker-compose.yml
├── server/                 # API Express + Mongoose
│   ├── src/
│   │   ├── index.js        # entrée
│   │   ├── app.js          # config Express
│   │   ├── routes.js       # routes /api
│   │   ├── config/db.js    # connexion Mongo (non bloquante)
│   │   ├── middleware.js   # asyncHandler, 404, erreurs
│   │   ├── models/         # JobOffer, Application, CVVersion, Profile
│   │   ├── controllers/    # logique par ressource
│   │   ├── services/       # tailoringService = couture du moteur IA
│   │   ├── utils/          # enums partagés
│   │   └── seed.js         # données de démo
│   └── Dockerfile
└── web/                    # React + Vite
    └── src/
        ├── pages/          # Offres, Candidatures, Profil
        ├── components/     # AddOfferForm, ApplicationDetail
        ├── api/client.js   # wrapper fetch
        ├── lib/status.js   # libellés + couleurs
        └── styles/tokens.css
```

## Démarrage — Docker (recommandé)

```bash
docker compose up --build
```

- Front : http://localhost:5173
- API : http://localhost:4000/api/health
- Données de démo (optionnel) :
  ```bash
  docker compose exec server npm run seed
  ```

## Démarrage — local (sans Docker)

Nécessite un MongoDB accessible (par défaut `mongodb://localhost:27017/filo`).

```bash
# Terminal 1 — API
cd server
cp .env.example .env
npm install
npm run seed      # optionnel
npm run dev

# Terminal 2 — front
cd web
npm install
npm run dev
```

## Variables d'environnement (serveur)

| Variable        | Défaut                              | Rôle                                   |
| --------------- | ----------------------------------- | -------------------------------------- |
| `PORT`          | `4000`                              | Port de l'API                          |
| `MONGO_URI`     | `mongodb://localhost:27017/filo`    | Connexion MongoDB                      |
| `PYTHON_AI_URL` | _(vide)_                            | URL du moteur IA. Vide = mode stub.    |

## API

| Méthode | Route                             | Description                            |
| ------- | --------------------------------- | -------------------------------------- |
| GET     | `/api/health`                     | Santé                                  |
| GET     | `/api/offers`                     | Liste des offres (`?source=`, `?q=`)   |
| POST    | `/api/offers`                     | Crée une offre                         |
| GET     | `/api/offers/:id`                 | Détail                                 |
| PATCH   | `/api/offers/:id`                 | Modifie                                |
| DELETE  | `/api/offers/:id`                 | Supprime                               |
| GET     | `/api/applications`               | Liste des candidatures (`?status=`)    |
| POST    | `/api/applications`               | Crée (depuis une offre)                |
| GET     | `/api/applications/:id`           | Détail                                 |
| PATCH   | `/api/applications/:id`           | Modifie (hors statut)                  |
| PATCH   | `/api/applications/:id/status`    | Change le statut + journalise timeline |
| POST    | `/api/applications/:id/tailor`    | Génère CV ciblé + lettre (via IA)      |
| DELETE  | `/api/applications/:id`           | Supprime                               |
| GET     | `/api/cv-versions`                | Liste des CV (`?kind=`)                |
| GET/PUT | `/api/profile`                    | CV maître (singleton)                  |

## Où se branche l'IA

Tout passe par `server/src/services/tailoringService.js`. Tant que
`PYTHON_AI_URL` est vide, une version « stub » déterministe est renvoyée pour
que l'ossature tourne de bout en bout.

Quand le moteur Python sera prêt, il devra exposer :

```
POST {PYTHON_AI_URL}/tailor
  entrée : { offer, profile }
  sortie : { content, coverLetter, score, keywords }
```

Aucun autre fichier n'a besoin de changer.

## Modèle de données

- **JobOffer** : l'annonce (données brutes).
- **Application** : la poursuite d'une offre → statut, `timeline`, CV utilisé, lettre, score.
- **CVVersion** : CV maître ou déclinaison ciblée par offre.
- **Profile** : profil unique = matière première du reciblage.

## Principe de conception

Filo est un **copilote**, pas un robot de masse. Il ne stocke pas d'identifiants
de plateformes et ne cherche pas à contourner les protections anti-robot : ces
approches font surtout bannir les comptes en pleine recherche, et l'envoi
quasi-identique en masse convertit mal. La valeur est ailleurs : agréger,
recibler finement, suivre — et te laisser valider chaque envoi.

## Suite

1. Moteur Python de reciblage CV + score de matching (`/tailor`).
2. Extraction auto d'une offre depuis son URL.
3. (Option) extension navigateur pour pré-remplir les formulaires pendant que tu es présent.
