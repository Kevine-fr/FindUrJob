"""Registre des sources d'offres.

Une source non configurée (clé absente) est simplement ignorée : la recherche
fonctionne avec ce qui est disponible, et la réponse dit ce qui a été utilisé.
"""

import asyncio
import logging

from ..config import Settings
from .adzuna import AdzunaSource
from .base import NormalizedOffer, SearchQuery, Source
from .france_travail import FranceTravailSource
from .remotive import RemotiveSource

logger = logging.getLogger(__name__)

__all__ = ["NormalizedOffer", "SearchQuery", "Source", "build_sources", "search_all"]


def build_sources(settings: Settings) -> list[Source]:
    timeout = settings.search_timeout_seconds
    candidates: list[Source] = [
        FranceTravailSource(
            settings.france_travail_client_id,
            settings.france_travail_client_secret,
            timeout=timeout,
        ),
        AdzunaSource(
            settings.adzuna_app_id,
            settings.adzuna_app_key,
            country=settings.adzuna_country,
            timeout=timeout,
        ),
        RemotiveSource(timeout=timeout),
    ]
    return [source for source in candidates if source.configured]


async def search_all(
    sources: list[Source],
    query: SearchQuery,
    *,
    only: list[str] | None = None,
) -> tuple[list[NormalizedOffer], dict[str, str]]:
    """Interroge les sources en parallèle. Une source en panne n'en bloque aucune autre."""
    selected = [source for source in sources if not only or source.name in only]
    if not selected:
        return [], {}

    results = await asyncio.gather(
        *(source.search(query) for source in selected), return_exceptions=True
    )

    offers: list[NormalizedOffer] = []
    report: dict[str, str] = {}
    for source, result in zip(selected, results):
        if isinstance(result, Exception):
            logger.warning("source %s en échec : %s", source.name, result)
            report[source.name] = f"échec ({type(result).__name__})"
            continue
        report[source.name] = f"{len(result)} offre(s)"
        offers.extend(result)

    # Dédoublonnage : même source + même identifiant, ou même URL.
    seen: set[str] = set()
    unique: list[NormalizedOffer] = []
    for offer in offers:
        key = f"{offer.source}:{offer.externalId}" if offer.externalId else offer.sourceUrl
        key = key or f"{offer.source}:{offer.title}:{offer.company}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(offer)

    return unique, report
