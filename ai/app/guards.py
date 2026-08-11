"""Garde-fous appliqués à la sortie du LLM.

Ils ne « corrigent » pas le texte : ils signalent ce qui doit attirer l'œil de
la personne qui relit (`meta.warnings`), et disent si la sortie est assez saine
pour être renvoyée telle quelle ou s'il faut retomber sur le rendu déterministe.
"""

import re

from .schemas import ProfileIn
from .textutils import padded, stem_text

_PLACEHOLDER_RE = re.compile(
    r"\[[^\]\n]{0,60}\]|\{\{[^}]{0,60}\}\}|\bXX+\b|\blorem ipsum\b|\bTODO\b|<[a-z_]+>",
    re.IGNORECASE,
)

_MIN_CV_CHARS = 200
_MIN_LETTER_CHARS = 120
_MAX_LETTER_WORDS = 420


def is_usable(content: str, cover_letter: str) -> bool:
    """Sortie assez complète pour être présentée à l'utilisateur ?"""
    return len(content.strip()) >= _MIN_CV_CHARS and len(cover_letter.strip()) >= _MIN_LETTER_CHARS


def inspect(content: str, cover_letter: str, profile: ProfileIn) -> list[str]:
    warnings: list[str] = []

    for label, text in (("le CV", content), ("la lettre", cover_letter)):
        found = _PLACEHOLDER_RE.findall(text)
        if found:
            sample = ", ".join(sorted({item.strip() for item in found})[:3])
            warnings.append(f"Texte à compléter détecté dans {label} : {sample}")

    words = len(cover_letter.split())
    if words > _MAX_LETTER_WORDS:
        warnings.append(f"Lettre longue ({words} mots) : à raccourcir avant envoi.")

    if profile.fullName:
        haystack = padded(stem_text(content))
        name_tokens = stem_text(profile.fullName).split()
        if name_tokens and not any(f" {token} " in haystack for token in name_tokens):
            warnings.append("Le nom du candidat n'apparaît pas dans le CV généré.")

    if not profile.skills and not profile.experiences and not profile.masterCv:
        warnings.append(
            "Profil quasi vide : le brouillon reste générique tant que le Profil "
            "n'est pas renseigné."
        )

    return warnings
