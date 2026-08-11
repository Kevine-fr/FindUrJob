"""Contrat commun à tous les fournisseurs de génération."""

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from ..keywords import Keyword
from ..schemas import OfferIn, ProfileIn


class ProviderError(RuntimeError):
    """Échec de génération : l'appelant retombe sur le rendu déterministe."""


@dataclass
class Generation:
    content: str
    cover_letter: str
    keywords: list[str] = field(default_factory=list)


@runtime_checkable
class Provider(Protocol):
    name: str
    model: str

    async def generate(
        self,
        *,
        offer: OfferIn,
        profile: ProfileIn,
        keywords: list[Keyword],
    ) -> Generation: ...

    async def aclose(self) -> None: ...
