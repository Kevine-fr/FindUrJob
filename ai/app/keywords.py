"""Extraction déterministe des mots-clés d'une offre.

Pas de LLM ici : c'est reproductible, gratuit, testable — et ça sert de socle
au score comme au prompt de reciblage.
"""

from collections import Counter
from dataclasses import dataclass

from .schemas import OfferIn
from .textutils import LEXICON, STOPWORDS, tokenize, tokenize_pairs

# Poids relatifs des différents signaux.
_BOOST_TITLE = 3.0  # présent dans l'intitulé du poste
_BOOST_LEXICON = 2.0  # terme métier connu
_BOOST_MANUAL = 2.5  # mot-clé saisi à la main sur l'offre
_BOOST_NGRAM = 1.3  # une expression est plus spécifique qu'un mot isolé
_PENALTY_COVERED = 0.5  # unigramme déjà porté par une expression retenue

_MAX_NGRAM = 3

# Sous ce poids relatif, un terme n'est ni un mot du lexique, ni de l'intitulé,
# ni répété : c'est du remplissage d'annonce (« participerez », « renforçons »).
# Le seuil est relatif au terme le plus fort : sur une offre uniformément
# pauvre, il ne supprime rien.
_MIN_WEIGHT = 0.12


@dataclass(frozen=True)
class Keyword:
    term: str  # forme affichable (casse d'origine)
    norm: str  # forme normalisée, utilisée pour les comparaisons
    weight: float  # poids relatif dans l'offre, entre 0 et 1

    def __str__(self) -> str:  # pragma: no cover - confort de debug
        return self.term


def _ngrams(tokens: list[str], size: int) -> list[tuple[str, ...]]:
    return [tuple(tokens[i : i + size]) for i in range(len(tokens) - size + 1)]


def extract_keywords(offer: OfferIn, *, limit: int = 24) -> list[Keyword]:
    """Mots-clés de l'offre, triés du plus au moins déterminant."""
    corpus = "\n".join(part for part in (offer.title, offer.description) if part)
    pairs = tokenize_pairs(corpus)
    if not pairs and not offer.keywords:
        return []

    tokens = [norm for norm, _ in pairs]

    # Forme d'affichage la plus fréquente pour chaque token normalisé.
    display_votes: dict[str, Counter[str]] = {}
    for norm, raw in pairs:
        display_votes.setdefault(norm, Counter())[raw] += 1
    for raw in offer.keywords:
        for norm, original in tokenize_pairs(raw):
            display_votes.setdefault(norm, Counter())[original] += 1

    def display(norm_term: str) -> str:
        words = []
        for part in norm_term.split():
            votes = display_votes.get(part)
            words.append(votes.most_common(1)[0][0] if votes else part)
        return " ".join(words)

    # Termes mis en avant : intitulé du poste et mots-clés saisis à la main.
    title_terms: set[str] = set(tokenize(offer.title))
    title_tokens = tokenize(offer.title)
    for size in range(2, _MAX_NGRAM + 1):
        title_terms.update(" ".join(gram) for gram in _ngrams(title_tokens, size))

    manual_terms: set[str] = set()
    for raw in offer.keywords:
        normalized = " ".join(tokenize(raw))
        if normalized:
            manual_terms.add(normalized)

    counts: Counter[str] = Counter(tokens)
    for size in range(2, _MAX_NGRAM + 1):
        counts.update(" ".join(gram) for gram in _ngrams(tokens, size))
    for term in manual_terms:
        counts[term] += 1

    raw_weights: dict[str, float] = {}
    for term, count in counts.items():
        parts = term.split()
        is_ngram = len(parts) > 1
        in_lexicon = term in LEXICON

        if is_ngram:
            # Seules les expressions connues (ou saisies à la main) sont gardées :
            # les suites de mots opportunistes — « stack Node.js React » — noient
            # les vrais mots-clés sans rien apporter.
            keep = in_lexicon or term in manual_terms
        else:
            keep = term not in STOPWORDS
        if not keep:
            continue

        weight = float(count)
        if term in title_terms:
            weight *= _BOOST_TITLE
        if in_lexicon:
            weight *= _BOOST_LEXICON
        if term in manual_terms:
            weight *= _BOOST_MANUAL
        if is_ngram:
            weight *= _BOOST_NGRAM
        raw_weights[term] = weight

    if not raw_weights:
        return []

    # Un mot déjà porté par une expression retenue pèse moins lourd seul.
    retained_ngrams = [term for term in raw_weights if " " in term]
    for ngram in retained_ngrams:
        for part in ngram.split():
            if part in raw_weights:
                raw_weights[part] *= _PENALTY_COVERED

    top = float(max(raw_weights.values()))
    keywords = [
        Keyword(term=display(term), norm=term, weight=round(weight / top, 4))
        for term, weight in raw_weights.items()
        if weight / top >= _MIN_WEIGHT
    ]
    keywords.sort(key=lambda kw: (-kw.weight, kw.norm))
    return keywords[:limit]
