"""Fournisseur déterministe : aucun appel réseau, aucune clé requise.

C'est le mode par défaut en développement, et le filet de sécurité quand le
LLM est indisponible.
"""

from ..keywords import Keyword
from ..rendering import render_cover_letter, render_cv
from ..schemas import OfferIn, ProfileIn
from .base import Generation


class OfflineProvider:
    name = "offline"
    model = "deterministe"

    async def generate(
        self,
        *,
        offer: OfferIn,
        profile: ProfileIn,
        keywords: list[Keyword],
    ) -> Generation:
        return Generation(
            content=render_cv(offer, profile, keywords, offline=True),
            cover_letter=render_cover_letter(offer, profile, keywords),
            keywords=[kw.term for kw in keywords],
        )

    async def aclose(self) -> None:
        return None
