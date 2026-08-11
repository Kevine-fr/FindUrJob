"""Score de matching offre ↔ profil, calculé sans LLM.

Un score doit être reproductible et explicable : deux appels sur les mêmes
données donnent la même note, et `ScoreBreakdown` dit d'où elle vient.

Quatre composantes, chacune notée puis renormalisée sur les seules composantes
applicables — une offre sans lieu ne doit pas pénaliser le candidat.
"""

import re
from dataclasses import dataclass
from datetime import date

from .keywords import Keyword
from .schemas import OfferIn, ProfileIn, ScoreBreakdown
from .textutils import STOPWORDS, contains_term, padded, stem_text, strip_accents, tokenize

_MAX_SKILLS = 60
_MAX_TITLE = 20
_MAX_SENIORITY = 10
_MAX_LOCATION = 10

# « 3 ans », « 5+ années », « 4 years » — mais pas les « 45000 € » d'un salaire.
_YEARS_REQUIRED_RE = re.compile(r"(?<!\d)(\d{1,2})\s*\+?\s*(?:ans?|annees?|years?|yrs?)\b")
_YEAR_RE = re.compile(r"\b(19[5-9]\d|20\d{2})\b")
_ONGOING_RE = re.compile(
    r"aujourd|present|actuel|en cours|ce jour|now|current|today", re.IGNORECASE
)

# Ce qui, dans un profil, peut légitimement prouver une compétence.
def profile_corpus(profile: ProfileIn) -> str:
    parts: list[str] = [
        profile.headline,
        profile.summary,
        " ".join(profile.skills),
        profile.masterCv,
    ]
    for exp in profile.experiences:
        parts.extend([exp.role, exp.company, exp.description])
    for edu in profile.education:
        parts.extend([edu.degree, edu.school])
    return "\n".join(part for part in parts if part)


def experience_years(profile: ProfileIn, *, today: date | None = None) -> float:
    """Années d'expérience estimées à partir des périodes, chevauchements fusionnés."""
    current_year = (today or date.today()).year
    intervals: list[tuple[int, int]] = []

    for exp in profile.experiences:
        period = exp.period or ""
        years = [int(match) for match in _YEAR_RE.findall(period)]
        if not years:
            continue
        start = min(years)
        end = current_year if _ONGOING_RE.search(period) else max(years)
        if end < start:
            start, end = end, start
        intervals.append((start, min(end, current_year)))

    if not intervals:
        return 0.0

    intervals.sort()
    merged: list[list[int]] = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    # Une expérience « 2023 » (une seule année mentionnée) compte pour 1 an.
    return float(sum(max(end - start, 1) for start, end in merged))


def required_years(offer: OfferIn) -> int:
    text = strip_accents(f"{offer.title}\n{offer.description}").lower()
    values = [int(value) for value in _YEARS_REQUIRED_RE.findall(text)]
    plausible = [value for value in values if 1 <= value <= 20]
    return min(plausible) if plausible else 0


def _significant(tokens: list[str]) -> set[str]:
    return {token for token in tokens if token not in STOPWORDS and len(token) > 2}


def _location_tokens(text: str) -> set[str]:
    return _significant(tokenize(text))


@dataclass
class ScoreResult:
    score: int
    breakdown: ScoreBreakdown


def compute_score(
    offer: OfferIn,
    profile: ProfileIn,
    keywords: list[Keyword],
    *,
    today: date | None = None,
) -> ScoreResult:
    corpus = profile_corpus(profile)
    haystack = padded(stem_text(corpus))

    obtained = 0.0
    available = 0.0
    breakdown = ScoreBreakdown()

    # --- 1. Couverture des compétences attendues ------------------------
    matched: list[str] = []
    missing: list[str] = []
    if keywords and corpus.strip():
        total_weight = sum(kw.weight for kw in keywords)
        covered_weight = 0.0
        for kw in keywords:
            if contains_term(haystack, kw.norm):
                covered_weight += kw.weight
                matched.append(kw.term)
            else:
                missing.append(kw.term)
        ratio = covered_weight / total_weight if total_weight else 0.0
        breakdown.skills = round(_MAX_SKILLS * ratio)
        obtained += breakdown.skills
        available += _MAX_SKILLS
    breakdown.matchedKeywords = matched[:12]
    breakdown.missingKeywords = missing[:12]

    # --- 2. Adéquation de l'intitulé ------------------------------------
    # Comparaison sur les formes canoniques : « développeuse » vaut « développeur ».
    title_tokens = _significant(stem_text(offer.title).split())
    role_text = " ".join(
        [profile.headline] + [exp.role for exp in profile.experiences if exp.role]
    )
    role_tokens = _significant(stem_text(role_text).split())
    if title_tokens and role_tokens:
        overlap = len(title_tokens & role_tokens) / len(title_tokens)
        breakdown.title = round(_MAX_TITLE * overlap)
        obtained += breakdown.title
        available += _MAX_TITLE

    # --- 3. Séniorité ----------------------------------------------------
    wanted = required_years(offer)
    have = experience_years(profile, today=today)
    if wanted and have:
        ratio = min(have / wanted, 1.0)
        breakdown.seniority = round(_MAX_SENIORITY * ratio)
        obtained += breakdown.seniority
        available += _MAX_SENIORITY

    # --- 4. Localisation / télétravail -----------------------------------
    remote = offer.remote or "non_precise"
    if remote == "teletravail":
        breakdown.location = _MAX_LOCATION
        obtained += breakdown.location
        available += _MAX_LOCATION
    elif offer.location and profile.location:
        same_city = bool(_location_tokens(offer.location) & _location_tokens(profile.location))
        if same_city:
            breakdown.location = _MAX_LOCATION
        else:
            # Pas la même ville : pénalisé, mais la mobilité reste possible.
            breakdown.location = 5 if remote == "hybride" else 3
        obtained += breakdown.location
        available += _MAX_LOCATION

    if available <= 0:
        return ScoreResult(score=0, breakdown=breakdown)

    score = round(100 * obtained / available)
    return ScoreResult(score=max(0, min(100, score)), breakdown=breakdown)
