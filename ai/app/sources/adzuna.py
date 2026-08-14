"""Adzuna — agrégateur multi-plateformes (API officielle).

Inscription gratuite sur https://developer.adzuna.com (app_id / app_key).
Couvre une bonne partie des annonces françaises, y compris relayées depuis
d'autres sites.
"""

import httpx

from .base import NormalizedOffer, SearchQuery, clean_html, guess_contract, guess_remote

SEARCH_URL = "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"

# Plafond imposé par l'API : au-delà, elle ignore le paramètre.
PER_PAGE = 50


class AdzunaSource:
    name = "adzuna"

    def __init__(self, app_id: str, app_key: str, country: str = "fr", timeout: float = 20.0):
        self._app_id = app_id
        self._app_key = app_key
        self._country = country
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._app_id and self._app_key)

    async def search(self, query: SearchQuery) -> list[NormalizedOffer]:
        params: dict[str, str | int] = {
            "app_id": self._app_id,
            "app_key": self._app_key,
            "results_per_page": PER_PAGE,
            "content-type": "application/json",
        }
        if query.text:
            params["what"] = query.text
        if query.location:
            params["where"] = query.location
        if "freelance" in query.contract_types:
            params["contract_type"] = "contract"
        elif "cdi" in query.contract_types:
            params["contract_type"] = "permanent"

        wanted = max(1, query.limit)
        results: list[dict] = []

        # L'API pagine par tranches de 50 : sans cette boucle, demander 200
        # offres en rend silencieusement 50.
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for page in range(1, (wanted // PER_PAGE) + 2):
                response = await client.get(
                    SEARCH_URL.format(country=self._country, page=page),
                    params=params,
                    headers={"Accept": "application/json"},
                )

                # Une page suivante en erreur ne doit pas effacer ce qui est déjà
                # collecté : au-delà du dernier résultat, l'API répond parfois en
                # 4xx plutôt que par une liste vide. On rend ce qu'on a.
                if response.status_code >= 400:
                    if results:
                        break
                    response.raise_for_status()

                batch = response.json().get("results", [])
                results.extend(batch)

                # Page incomplète = fin des résultats, inutile d'en demander une autre.
                if len(batch) < PER_PAGE or len(results) >= wanted:
                    break

        results = results[:wanted]
        offers: list[NormalizedOffer] = []
        for item in results:
            description = clean_html(item.get("description", ""))
            title = item.get("title", "")
            contract = item.get("contract_type") or item.get("contract_time") or ""
            offers.append(
                NormalizedOffer(
                    title=clean_html(title),
                    company=(item.get("company") or {}).get("display_name", "") or "",
                    location=(item.get("location") or {}).get("display_name", "") or "",
                    source=self.name,
                    sourceUrl=item.get("redirect_url", "") or "",
                    externalId=str(item.get("id", "")),
                    description=description,
                    contractType=guess_contract(contract, title, description[:400]),
                    remote=guess_remote(title, description),
                    salary=_salary(item),
                    publishedAt=item.get("created"),
                )
            )
        return offers


def _salary(item: dict) -> str:
    low, high = item.get("salary_min"), item.get("salary_max")
    if not low and not high:
        return ""
    if low and high and low != high:
        return f"{int(low):,} – {int(high):,} €".replace(",", " ")
    return f"{int(low or high):,} €".replace(",", " ")
