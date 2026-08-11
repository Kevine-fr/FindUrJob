# FindUrJob — copilote de candidatures

FindUrJob fait le gros du travail de candidature : agrégation d'offres,
**réécriture du CV pour chaque offre**, lettre, filtres, suivi et historique.
Les envois partent depuis ta propre session navigateur — pas de mot de passe
stocké, pas de contournement d'anti-bot : voir « Principe de conception ».

Trois briques : le **backend Node/Express + Mongo**, le **front React/Vite**, et
le **moteur IA (Python/FastAPI)** branché sur une couture unique.

## Arborescence

```
findurjob/
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
├── ai/                     # Moteur IA de reciblage (FastAPI)
│   ├── app/
│   │   ├── main.py         # POST /tailor, GET /health
│   │   ├── keywords.py     # extraction déterministe
│   │   ├── scoring.py      # score 0–100 explicable
│   │   ├── prompts.py      # prompts FR, règle anti-invention
│   │   ├── guards.py       # relecture automatique de la sortie
│   │   ├── rendering.py    # rendu déterministe (hors-ligne + repli)
│   │   └── providers/      # anthropic | offline
│   ├── tests/              # pytest, sans appel réseau
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
- Moteur IA : http://localhost:8000/health
- Données de démo (optionnel) :
  ```bash
  docker compose exec server npm run seed
  ```

Pour brancher un vrai LLM, copier `ai/.env.example` en `ai/.env` et y mettre la
clé API. Sans clé, le moteur tourne en mode déterministe hors-ligne : tout
fonctionne de bout en bout, les brouillons sont simplement réorganisés plutôt
que rédigés.

## Démarrage — local (sans Docker)

Nécessite un MongoDB accessible (par défaut `mongodb://localhost:27017/findurjob`).

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
| `MONGO_URI`     | `mongodb://localhost:27017/findurjob`    | Connexion MongoDB                      |
| `PYTHON_AI_URL` | _(vide)_                            | URL du moteur IA. Vide = mode stub.    |

Sous Docker Compose, `PYTHON_AI_URL` vaut `http://ai:8000` : le serveur attend
que le moteur soit *healthy* avant de démarrer. Les variables du moteur IA
(fournisseur, clé, modèle) sont documentées dans [`ai/README.md`](ai/README.md).

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
| GET/PUT | `/api/profile`                    | Profil (singleton)                     |
| POST    | `/api/profile/cv`                 | Dépôt du CV (PDF/DOCX/TXT/MD)          |
| DELETE  | `/api/profile/cv`                 | Retire le CV déposé                    |
| GET/PUT | `/api/preferences`                | Préférences de recherche (singleton)   |
| GET     | `/api/history`                    | Historique (`?type=`, `?status=`, `?from=`, `?to=`) |

`GET /api/offers` accepte `?q=`, `?location=`, et des listes séparées par des
virgules : `?contractType=cdi,alternance&remote=teletravail,hybride&source=linkedin`.

## Où se branche l'IA

Tout passe par `server/src/services/tailoringService.js`. Tant que
`PYTHON_AI_URL` est vide, une version « stub » déterministe est renvoyée pour
que l'ossature tourne de bout en bout.

Le moteur Python expose exactement ce contrat :

```
POST {PYTHON_AI_URL}/tailor
  entrée : { offer, profile }
  sortie : { content, coverLetter, score, keywords }

POST {PYTHON_AI_URL}/extract-cv        (multipart : le fichier déposé)
  sortie : { text, chars, pages, filename, warnings }
```

Aucun autre fichier n'a eu besoin de changer. Le moteur ajoute un champ `meta`
(fournisseur, avertissements de relecture, détail du score) que le serveur
ignore. Détail du fonctionnement : [`ai/README.md`](ai/README.md).

## Modèle de données

- **JobOffer** : l'annonce (données brutes).
- **Application** : la poursuite d'une offre → statut, `timeline`, CV utilisé, lettre, score.
- **CVVersion** : CV maître ou déclinaison ciblée par offre.
- **Profile** : profil unique = matière première du reciblage.

## Principe de conception

FindUrJob automatise les candidatures **sans jamais stocker de mot de passe**.

Le modèle retenu est la *session persistante* : tu te connectes toi-même une
fois par plateforme (2FA comprise) dans un navigateur piloté ; la session reste
ouverte et l'outil enchaîne ensuite les candidatures selon tes filtres et ton
quota. Aucun identifiant en base, aucune protection anti-robot contournée —
c'est ta vraie session, dans un vrai navigateur, à cadence humaine.

Le quota quotidien n'est pas une limitation technique mais un choix : un volume
raisonnable passe inaperçu et convertit mieux qu'un envoi de masse identique.

## Suite

1. ~~Moteur Python de reciblage CV + score de matching (`/tailor`).~~ ✅
2. ~~Dépôt du CV (PDF/DOCX) et réécriture par offre.~~ ✅
3. ~~Filtres, préférences de recherche, historique.~~ ✅
4. Agrégation : API France Travail / Adzuna + import d'une offre depuis son URL.
5. Campagnes de candidature : session persistante Playwright + suivi en direct.
