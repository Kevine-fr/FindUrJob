"""Primitives de texte partagées : normalisation, tokenisation, comparaison.

Tout le reste du moteur (mots-clés, score, rendu) s'appuie sur ces fonctions,
pour que « Développeur Full-Stack » et « developpeur full stack » soient
traités comme la même chose.
"""

import re
import unicodedata

# Séparateurs « durs » : ponctuation qui découpe toujours un token.
# On garde volontairement `+ # . / -` à l'intérieur des tokens pour préserver
# c++, c#, node.js, ci/cd, back-end.
_SPLIT_RE = re.compile(r"[\s,;:!?()\[\]{}«»\"'’`|<>*=~^%&\\]+")
_DROP_RE = re.compile(r"[^a-z0-9+#./-]+")
_DIGITS_RE = re.compile(r"^[0-9]+$")

STOPWORDS: frozenset[str] = frozenset(
    """
    a au aux avec ce ces dans de des du elle en et eux il ils je la le les leur lui ma mais me
    meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes
    toi ton tu un une vos votre vous y d l n s c j m t qu est sont etre avoir fait faire plus tres
    tout tous toute toutes autre autres chez sans sous entre vers apres avant depuis pendant afin
    ainsi donc car dont lors si comme aussi bien deja encore cette cet celui celle ceux
    the a an and or of to in for on with at by from as is are be been being this that these those
    it its you your we our they their he she his her will would can could should may might must
    have has had do does did not no yes but if then than there here when where which who whom
    poste offre mission missions profil profils recherche recherchons rejoindre equipe entreprise
    societe candidat candidate candidats experience experiences competences competence savoir
    ans annee annees jour jours mois an
    h/f f/h h/f/x m/f w/m hf fh
    """.split()
)

# Termes métier qui méritent d'être remontés même s'ils n'apparaissent qu'une
# fois, et qui échappent aux filtres de fréquence. Liste volontairement courte
# et extensible : elle oriente le tri, elle ne le décide pas.
def _build_lexicon() -> frozenset[str]:
    single = """
    python javascript typescript java kotlin swift golang go rust php ruby scala elixir perl
    c++ c# .net dotnet node node.js deno bun react vue angular svelte next.js nuxt remix jquery
    django flask fastapi rails laravel symfony spring quarkus express nestjs strapi
    html css sass scss tailwind bootstrap webpack vite rollup babel eslint prettier
    sql nosql postgresql postgres mysql mariadb mongodb mongoose redis elasticsearch cassandra
    dynamodb sqlite oracle clickhouse kafka rabbitmq prisma sequelize
    docker kubernetes k8s helm terraform ansible puppet vagrant openshift podman
    aws azure gcp ovh scaleway digitalocean cloudflare heroku vercel netlify s3 lambda
    linux unix debian ubuntu bash shell powershell nginx apache traefik haproxy systemd
    git github gitlab bitbucket jenkins circleci ci/cd ci-cd cicd devops sre gitops
    prometheus grafana datadog sentry elk kibana logstash opentelemetry
    api rest restful graphql grpc soap websocket microservices monolithe serverless webhook
    agile scrum kanban jira confluence notion
    tdd bdd ddd solid refactoring
    pytorch tensorflow scikit-learn pandas numpy jupyter llm nlp
    figma sketch ux ui accessibilite rgaa rgpd seo
    anglais bilingue courant autonomie rigueur pedagogie
    architecture securite performance monitoring observabilite scalabilite
    frontend backend fullstack full-stack front-end back-end mobile android ios flutter
    """.split()
    multi = [
        "base de donnees",
        "bases de donnees",
        "intelligence artificielle",
        "gestion de projet",
        "travail en equipe",
        "integration continue",
        "deploiement continu",
        "architecture logicielle",
        "revue de code",
        "tests unitaires",
        "tests automatises",
        "machine learning",
        "deep learning",
        "clean code",
        "pair programming",
        "haute disponibilite",
        "veille technologique",
        "esprit d equipe",
    ]
    return frozenset(single + multi)


LEXICON = _build_lexicon()


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def normalize_token(raw: str) -> str:
    """Token brut → forme canonique, ou chaîne vide si le token est inutile."""
    token = _DROP_RE.sub("", strip_accents(raw).lower())
    token = token.strip("./-")
    if len(token) < 2 or _DIGITS_RE.match(token):
        return ""
    return token


def tokenize_pairs(text: str) -> list[tuple[str, str]]:
    """Liste de (forme normalisée, forme d'origine), alignées et filtrées."""
    pairs: list[tuple[str, str]] = []
    for raw in _SPLIT_RE.split(text or ""):
        if not raw:
            continue
        norm = normalize_token(raw)
        if norm:
            pairs.append((norm, raw.strip(".,;:!?…-")))
    return pairs


def tokenize(text: str) -> list[str]:
    return [norm for norm, _ in tokenize_pairs(text)]


def normalize_text(text: str) -> str:
    return " ".join(tokenize(text))


# Suffixes féminins des noms de métier : « développeuse » et « développeur »
# désignent le même poste et doivent se rapprocher.
_GENDER_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("euse", "eur"),
    ("trice", "teur"),
    ("ienne", "ien"),
    ("iere", "ier"),
    ("ale", "al"),
)


def singularize(token: str) -> str:
    """Pluriel français/anglais le plus courant, sans dictionnaire."""
    if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is", "as", "os")):
        return token[:-1]
    return token


def degender(token: str) -> str:
    """Rapproche le féminin du masculin sur les suffixes de métier courants."""
    if len(token) <= 5:
        return token
    for feminine, masculine in _GENDER_SUFFIXES:
        if token.endswith(feminine):
            return token[: -len(feminine)] + masculine
    return token


# Variantes d'écriture d'un même outil : une annonce écrit « CI-CD » là où un CV
# écrit « CI/CD ». Sans ça, la compétence est comptée comme absente.
_ALIASES: dict[str, str] = {
    "ci-cd": "ci/cd",
    "cicd": "ci/cd",
    "nodejs": "node.js",
    "node-js": "node.js",
    "nextjs": "next.js",
    "nuxtjs": "nuxt",
    "vuejs": "vue",
    "reactjs": "react",
    "postgres": "postgresql",
    "psql": "postgresql",
    "k8s": "kubernetes",
    "front-end": "frontend",
    "back-end": "backend",
    "full-stack": "fullstack",
    "full stack": "fullstack",
    "dot-net": ".net",
    "golang": "go",
}


def canonical_token(token: str) -> str:
    """Forme de comparaison d'un token : variantes, pluriel et genre unifiés.

    Les identifiants techniques (node.js, c++, aws, s3…) sont laissés intacts :
    leur « s » final n'est pas une marque de pluriel.
    """
    token = _ALIASES.get(token, token)
    if token in LEXICON or any(char in token for char in ".+#/0123456789"):
        return token
    return degender(singularize(token))


def stem_text(text: str) -> str:
    return " ".join(canonical_token(token) for token in tokenize(text))


def stem_term(term: str) -> str:
    """Même traitement que `stem_text`, mais pour un terme déjà normalisé."""
    return " ".join(canonical_token(token) for token in term.split())


def padded(text: str) -> str:
    """Encadre de blancs pour permettre des recherches de termes entiers."""
    return f" {text} "


def contains_term(haystack_padded: str, term: str) -> bool:
    """Le terme (uni ou multi-mots) apparaît-il en entier dans le texte ?"""
    stemmed = stem_term(term)
    return bool(stemmed) and f" {stemmed} " in haystack_padded


def truncate(text: str, limit: int) -> str:
    """Tronque sur une frontière de mot, en signalant la coupe."""
    if limit <= 0 or len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip() + " […]"
