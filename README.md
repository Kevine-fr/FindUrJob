# FindUrJob — copilote de candidatures

FindUrJob fait le gros du travail de candidature : agrégation d'offres,
**réécriture du CV pour chaque offre**, **export d'un CV PDF tenant sur une
page**, lettre, filtres, suivi et historique.

Quatre briques : le **backend Node/Express + Mongo**, le **front React/Vite**,
le **moteur IA (Python/FastAPI)** branché sur une couture unique, et le
**navigateur piloté (Node/Playwright)** pour tout ce qui n'a pas d'API.

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
├── bot/                    # Navigateur piloté (Playwright)
│   ├── src/
│   │   ├── app.js          # /pdf, /search, /login, /apply, /sessions
│   │   ├── browser.js      # contextes persistants = sessions qui durent
│   │   ├── pdf.js          # HTML → PDF A4 une page
│   │   └── platforms/      # linkedin, indeed, hellowork
│   └── Dockerfile
└── web/                    # React + Vite
    └── src/
        ├── pages/          # Offres, Candidatures, Historique, Comptes, Mon CV
        ├── components/     # Toast, CvPreview, CvFields, filtres…
        ├── lib/cvTemplate.js # le CV en document HTML autonome
        ├── api/client.js   # wrapper fetch
        └── styles/tokens.css
```

## Démarrage — Docker (recommandé)

```bash
docker compose up --build
```

- Front : http://localhost:5173
- API : http://localhost:4000/api/health
- Moteur IA : http://localhost:8000/health
- Navigateur piloté : http://localhost:8100/health

> La première construction du service `bot` télécharge Chromium (~1 Go) : compter
> quelques minutes. Les suivantes sont en cache.
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

| Variable           | Défaut                                | Rôle                                   |
| ------------------ | ------------------------------------- | -------------------------------------- |
| `PORT`             | `4000`                                | Port de l'API                          |
| `MONGO_URI`        | `mongodb://localhost:27017/findurjob` | Connexion MongoDB                      |
| `PYTHON_AI_URL`    | _(vide)_                              | URL du moteur IA. Vide = mode stub.    |
| `BOT_URL`          | _(vide)_                              | URL du navigateur piloté. Vide = PDF et scraping désactivés. |
| `CREDENTIALS_KEY`  | _(vide)_                              | Clé AES-256 du coffre d'identifiants. Vide = aucun mot de passe stockable. |

Sous Docker Compose, `PYTHON_AI_URL` vaut `http://ai:8000` et `BOT_URL`
`http://bot:8100` : le serveur attend que les deux soient *healthy* avant de
démarrer. Les variables du moteur IA (fournisseur, clé, modèle, **sources
d'offres**) sont documentées dans [`ai/README.md`](ai/README.md).

La clé de chiffrement se génère une fois et se met dans un `.env` à la racine
(ignoré par git) :

```bash
echo "CREDENTIALS_KEY=$(openssl rand -hex 32)" >> .env
```

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
| POST    | `/api/cv/pdf`                     | Document HTML → PDF A4 une page        |
| GET     | `/api/accounts`                   | Comptes de plateformes + état des sessions |
| PUT     | `/api/accounts/:platform`         | Enregistre e-mail + mot de passe (chiffré) |
| POST    | `/api/accounts/:platform/login`   | Ouvre la session sur la plateforme     |
| POST    | `/api/accounts/:platform/logout`  | Ferme la session, garde les identifiants |
| DELETE  | `/api/accounts/:platform`         | Oublie identifiants et session         |

`GET /api/offers` accepte `?q=`, `?location=`, et des listes séparées par des
virgules : `?contractType=cdi,alternance&remote=teletravail,hybride&source=linkedin`.

Il est **paginé** (`?page=`, `?limit=`, 60 par défaut, 200 au maximum) et
renvoie `{ offers, total, page, pages, limit }` — sans le total, l'interface ne
peut pas distinguer « 60 offres en base » de « 60 affichées sur 400 ».

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

## D'où viennent les offres

Deux chemins, selon que la plateforme expose une API ou non.

| Source | Voie | Ce qu'il faut |
| ------ | ---- | ------------- |
| France Travail | API officielle | `FRANCE_TRAVAIL_CLIENT_ID` / `_SECRET` dans `ai/.env` |
| Adzuna | API officielle | `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` dans `ai/.env` |
| Remotive | API publique | rien |
| LinkedIn | navigateur piloté | rien pour lire ; une session pour candidater |
| HelloWork | navigateur piloté | rien pour lire ; une session pour candidater |
| Indeed | navigateur piloté | une session ouverte (Cloudflare bloque sinon) |

> **Une source sans identifiants est ignorée en silence.** C'est la cause la
> plus fréquente d'un « je ne vois aucune offre France Travail » : le code est
> là, la clé manque. Le détail par source est affiché après chaque recherche.

`limit` s'entend **par source** : demander 50 sur quatre sources branchées peut
rapporter jusqu'à 200 offres en une passe.

## Le CV en PDF, sur une page

Le gabarit vit dans [`web/src/lib/cvTemplate.js`](web/src/lib/cvTemplate.js) et
produit un **document HTML autonome** — styles et photo compris, aucune requête
sortante. Ce document sert deux fois : l'aperçu le charge dans une iframe, et
Chromium l'imprime. L'aperçu affiché *est* le PDF, pas une approximation.

L'ajustement à une page est embarqué dans le document lui-même, parce que
l'aperçu et le conteneur n'ont pas les mêmes polices, donc pas les mêmes
hauteurs de ligne. Chacun mesure chez lui, avec le même algorithme :

1. tout est exprimé en `em`, donc relatif à une variable `--k` unique ;
2. recherche dichotomique de la plus grande densité qui tienne (jusqu'à 0,74) ;
3. si ça ne suffit toujours pas, retrait des éléments les moins utiles selon une
   échelle explicite (`TRIM`) : la 9ᵉ techno d'une famille d'abord, une
   expérience entière en tout dernier recours — et jamais les deux premières.

Le PDF garde une **couche texte réelle** (pas une image) : un ATS le lit. La
césure automatique est volontairement désactivée — elle insérerait un U+2010
dans le texte extrait, et « microservice » y deviendrait « mi-croservice ».

## Installable (PWA)

Le front est installable sur mobile comme sur bureau : manifeste, icônes
(dont une variante *maskable* pour Android) et service worker maison dans
[`web/public/`](web/public/).

La règle de cache tient en trois lignes : les fichiers compilés portent une
empreinte dans leur nom, donc cache définitif ; la navigation passe par le
réseau avec la coquille en secours, ce qui permet d'ouvrir l'application hors
connexion ; **`/api` n'est jamais mis en cache** — afficher une offre ou un état
de session périmés serait pire que d'afficher une erreur.

Le service worker n'est enregistré que sur le build de production : en
développement, il servirait d'anciens fichiers et masquerait les modifications
en cours.

## Comptes de plateformes et candidatures

LinkedIn, Indeed et HelloWork n'ont pas d'API : FindUrJob s'y connecte dans un
vrai navigateur, avec tes identifiants, depuis l'onglet **Comptes**.

- Les mots de passe sont chiffrés en **AES-256-GCM** avant d'atteindre la base
  ([`server/src/utils/vault.js`](server/src/utils/vault.js)). La clé vit dans
  l'environnement, pas en base : une copie de Mongo seule ne donne rien.
- Ils ne sont **jamais renvoyés** au front, et ne sont déchiffrés qu'au moment
  de remplir le formulaire de connexion.
- Sans `CREDENTIALS_KEY`, le serveur **refuse** d'enregistrer un mot de passe
  plutôt que de le stocker en clair.
- La session ouverte est conservée sur disque (volume `bot_profiles`) : on se
  connecte une fois, pas à chaque candidature.

**Ce que l'outil ne fait pas** : franchir une 2FA ou un captcha. Quand la
plateforme en présente un, la candidature s'arrête et te rend la main — c'est
une limite assumée, pas un manque. Un login automatisé sur LinkedIn ou Indeed
déclenche d'ailleurs souvent une vérification : c'est normal, valide-la une
fois et la session tient ensuite des semaines.

Le quota quotidien par plateforme n'est pas une limitation technique mais un
choix : un volume raisonnable convertit mieux qu'un envoi de masse identique.

## Suite

1. ~~Moteur Python de reciblage CV + score de matching (`/tailor`).~~ ✅
2. ~~Dépôt du CV (PDF/DOCX) et réécriture par offre.~~ ✅
3. ~~Filtres, préférences de recherche, historique.~~ ✅
4. ~~Agrégation : France Travail / Adzuna / Remotive + LinkedIn, Indeed, HelloWork.~~ ✅
5. ~~Constructeur de CV et export PDF une page.~~ ✅
6. ~~Fiche détaillée d'une offre, application installable (PWA).~~ ✅
7. Campagnes de candidature : file d'attente, quota et suivi en direct.
8. Import d'une offre depuis son URL.
