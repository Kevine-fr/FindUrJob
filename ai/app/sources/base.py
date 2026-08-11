"""Socle commun aux sources d'offres.

Chaque source renvoie des offres normalisées au format attendu par le modèle
`JobOffer` du serveur Node : aucune source n'impose son vocabulaire au reste
de l'application.
"""

import re
from dataclasses import asdict, dataclass, field
from typing import Protocol

from ..textutils import strip_accents

# Miroir de server/src/utils/constants.js
CONTRACT_TYPES = ("cdi", "cdd", "stage", "alternance", "freelance", "autre")
REMOTE_VALUES = ("sur_site", "hybride", "teletravail", "non_precise")


@dataclass
class NormalizedOffer:
    title: str
    company: str = ""
    location: str = ""
    source: str = "autre"
    sourceUrl: str = ""
    externalId: str = ""
    description: str = ""
    contractType: str = "autre"
    remote: str = "non_precise"
    salary: str = ""
    keywords: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class Source(Protocol):
    name: str  # valeur stockée dans JobOffer.source

    @property
    def configured(self) -> bool: ...

    async def search(self, query: "SearchQuery") -> list[NormalizedOffer]: ...


@dataclass
class SearchQuery:
    keywords: list[str] = field(default_factory=list)
    location: str = ""
    contract_types: list[str] = field(default_factory=list)
    remotes: list[str] = field(default_factory=list)
    limit: int = 25

    @property
    def text(self) -> str:
        return " ".join(self.keywords).strip()

    @property
    def wants_remote(self) -> bool:
        return "teletravail" in self.remotes


# --- Aides de normalisation --------------------------------------------

_REMOTE_HINTS = (
    "teletravail",
    "100% remote",
    "full remote",
    "remote",
    "a distance",
    "distanciel",
)
_HYBRID_HINTS = ("hybride", "partiel", "hybrid", "2 jours", "3 jours")


def guess_remote(*texts: str) -> str:
    """Déduit le mode de travail d'un texte libre, faute de champ dédié."""
    blob = strip_accents(" ".join(text or "" for text in texts)).lower()
    if any(hint in blob for hint in _HYBRID_HINTS):
        return "hybride"
    if any(hint in blob for hint in _REMOTE_HINTS):
        return "teletravail"
    return "non_precise"


def guess_contract(*texts: str) -> str:
    # Les APIs écrivent « full_time », « fixed-term »… : on unifie les séparateurs.
    blob = strip_accents(" ".join(text or "" for text in texts)).lower().replace("_", " ")
    if "alternance" in blob or "apprentissage" in blob or "apprentice" in blob:
        return "alternance"
    if "stage" in blob or "internship" in blob or blob.strip() == "sai":
        return "stage"
    if "freelance" in blob or "independant" in blob or "contractor" in blob:
        return "freelance"
    if re.search(r"\bcdd\b|temporary|fixed[- ]term|contract\b", blob):
        return "cdd"
    if re.search(r"\bcdi\b|permanent|full[- ]time", blob):
        return "cdi"
    return "autre"


def clean_html(raw: str) -> str:
    """Description HTML → texte lisible (les APIs d'emploi en renvoient souvent)."""
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>|</p>|</li>|</div>", "\n", raw, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    replacements = {
        "&nbsp;": " ",
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
        "&eacute;": "é",
        "&egrave;": "è",
        "&agrave;": "à",
        "&ccedil;": "ç",
    }
    for entity, char in replacements.items():
        text = text.replace(entity, char)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
