"""Remotive — offres tech en télétravail, API publique sans clé.

Sert de source par défaut : elle fonctionne dès le premier démarrage, sans
inscription, ce qui permet de vérifier toute la chaîne avant d'obtenir les
identifiants France Travail ou Adzuna.
"""

import httpx

from ..textutils import strip_accents
from .base import NormalizedOffer, SearchQuery, clean_html, guess_contract

SEARCH_URL = "https://remotive.com/api/remote-jobs"


def _matches(item: dict, terms: list[str]) -> bool:
    """L'API renvoie parfois tout son flux malgré `search` : on refiltre ici."""
    if not terms:
        return True
    blob = strip_accents(
        " ".join(
            [
                item.get("title", ""),
                item.get("category", ""),
                " ".join(item.get("tags") or []),
                (item.get("description") or "")[:600],
            ]
        )
    ).lower()
    return any(term in blob for term in terms)


class RemotiveSource:
    name = "remotive"

    def __init__(self, timeout: float = 20.0) -> None:
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return True  # aucune clé requise

    async def search(self, query: SearchQuery) -> list[NormalizedOffer]:
        params: dict[str, str | int] = {}
        if query.text:
            params["search"] = query.text

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(
                SEARCH_URL, params=params, headers={"Accept": "application/json"}
            )
            response.raise_for_status()
            jobs = response.json().get("jobs", [])

        terms = [
            strip_accents(word).lower()
            for keyword in query.keywords
            for word in keyword.split()
            if len(word) > 2
        ]
        jobs = [item for item in jobs if _matches(item, terms)][: max(1, query.limit)]

        offers: list[NormalizedOffer] = []
        for item in jobs:
            description = clean_html(item.get("description", ""))
            offers.append(
                NormalizedOffer(
                    title=item.get("title", "").strip(),
                    company=item.get("company_name", "") or "",
                    location=item.get("candidate_required_location", "") or "Télétravail",
                    source=self.name,
                    sourceUrl=item.get("url", "") or "",
                    externalId=str(item.get("id", "")),
                    description=description,
                    contractType=guess_contract(item.get("job_type", "")),
                    remote="teletravail",  # toutes les annonces de Remotive le sont
                    salary=item.get("salary", "") or "",
                    keywords=[tag for tag in (item.get("tags") or []) if isinstance(tag, str)][:12],
                )
            )
        return offers
