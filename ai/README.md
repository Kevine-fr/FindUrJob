# Moteur IA de reciblage — FindUrJob

Service Python autonome (FastAPI). À partir d'une offre et d'un profil, il
produit un **brouillon** de CV reciblé, une lettre de motivation, un score de
matching et les mots-clés de l'offre.

C'est un copilote : tout ce qui sort d'ici est relu et validé par la personne
avant le moindre envoi.

## Contrat

```
POST /tailor
  entrée : { offer, profile }
  sortie : { content, coverLetter, score, keywords, meta }

GET /health
  sortie : { status, provider, model, llm, version }
```

- `content` — CV reciblé, en Markdown, en français
- `coverLetter` — lettre, texte brut
- `score` — matching offre ↔ profil, entier 0–100
- `keywords` — mots-clés extraits de l'offre
- `meta` — **hors contrat**, ignoré par l'API Node : fournisseur, modèle,
  durée, avertissements de relecture, détail du score

## Ce qui est déterministe, ce qui passe par le LLM

| Étage | Comment | Pourquoi |
| --- | --- | --- |
| Mots-clés | Python | Reproductible, gratuit, testable |
| Score | Python | Un score doit être explicable et stable d'un appel à l'autre |
| CV + lettre | LLM (repli déterministe) | C'est la seule étape qui demande de la rédaction |

Le score se décompose en compétences couvertes (60), adéquation de l'intitulé
(20), séniorité (10) et localisation/télétravail (10), renormalisé sur les
seules composantes applicables — une offre sans lieu ne pénalise personne.
`meta.scoreBreakdown` donne le détail, mots-clés couverts et manquants compris.

## Anti-invention

Le prompt système interdit d'ajouter le moindre fait absent du profil
(entreprise, diplôme, techno, date, chiffre). Après génération, des garde-fous
déterministes relisent la sortie : `[texte à compléter]`, lettre à rallonge,
nom du candidat disparu, profil vide. Chaque anomalie ressort dans
`meta.warnings`. Si la sortie est inexploitable, le service retombe sur le
rendu déterministe : il ne renvoie jamais une page blanche.

## Configuration

Copier `.env.example` en `.env` (ignoré par git) et compléter.
**Aucune clé ne doit être committée.**

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `AI_PROVIDER` | `auto` | `auto` \| `anthropic` \| `offline` |
| `ANTHROPIC_API_KEY` | _(vide)_ | Clé API. Vide ⇒ mode hors-ligne |
| `AI_MODEL` | `claude-opus-5` | Modèle utilisé |
| `AI_EFFORT` | `medium` | `low` … `max` : profondeur de raisonnement |
| `AI_MAX_TOKENS` | `8000` | Plafond de sortie |
| `AI_TIMEOUT_SECONDS` | `90` | Délai d'appel au modèle |
| `AI_MAX_RETRIES` | `2` | Reprises sur 429/5xx |
| `AI_MAX_DESCRIPTION_CHARS` | `12000` | Troncature des annonces géantes |
| `AI_MAX_KEYWORDS` | `20` | Mots-clés renvoyés |
| `LOG_LEVEL` | `info` | |

`auto` choisit Anthropic si une clé est présente, sinon le mode hors-ligne :
le service démarre et répond dans tous les cas.

## Lancer

Avec Docker Compose, depuis la racine du dépôt :

```bash
docker compose up --build            # le service écoute sur :8000
curl localhost:8000/health
```

En local, sans Docker :

```bash
cd ai
python -m venv .venv && . .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Essai direct :

```bash
curl -s -X POST localhost:8000/tailor \
  -H 'Content-Type: application/json' \
  -d @tests/fixtures/sample.json | jq '{score, keywords, warnings: .meta.warnings}'
```

## Tests

```bash
docker compose exec ai pytest        # ou, en local : pytest
```

La suite tourne intégralement en mode hors-ligne : **aucun appel réseau, aucune
clé nécessaire**. Elle couvre le contrat, l'extraction de mots-clés, le score,
le rendu, les garde-fous et les entrées dégradées (payload vide, champs `null`,
annonce de 300 000 caractères).

## Notes de production

- **Épingler les versions** : après le premier build, `docker compose exec ai
  pip freeze > requirements.lock` donne le jeu exact.
- **Données transmises** : en mode `anthropic`, l'offre et le profil (nom,
  email, téléphone compris) sont envoyés à l'API du fournisseur. En mode
  `offline`, rien ne sort de la machine.
- **Coût** : le prompt système est constant et marqué en cache ; à partir de la
  deuxième candidature il n'est plus refacturé au prix plein. `AI_EFFORT=low`
  réduit encore la note si le volume grimpe.
- **Refus du modèle** : un refus (`stop_reason: refusal`) est traité comme une
  panne — brouillon déterministe + avertissement, jamais d'erreur remontée à
  l'utilisateur.
