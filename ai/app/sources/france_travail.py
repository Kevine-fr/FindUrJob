"""France Travail — API officielle « Offres d'emploi v2 ».

Source de référence pour le marché français. Demande une inscription
développeur gratuite sur https://francetravail.io (client_id / client_secret).
"""

import logging
import time

import httpx

from .base import NormalizedOffer, SearchQuery, clean_html, guess_contract, guess_remote

logger = logging.getLogger(__name__)

TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token"
SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search"
SCOPE = "api_offresdemploiv2 o2dsoffre"

# L'API refuse une plage de plus de 150 offres par appel.
PER_CALL = 150

# typeContrat de l'API → vocabulaire FindUrJob
_CONTRACT_MAP = {
    "CDI": "cdi",
    "CDD": "cdd",
    "MIS": "cdd",  # mission d'intérim
    "SAI": "cdd",  # saisonnier
    "DDI": "cdd",
    "FRA": "freelance",
    "LIB": "freelance",
    "CCE": "alternance",
    "APP": "alternance",
    "CDS": "alternance",
}


class FranceTravailSource:
    name = "francetravail"

    def __init__(self, client_id: str, client_secret: str, timeout: float = 20.0) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._timeout = timeout
        self._token = ""
        self._token_expires_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    async def _access_token(self, client: httpx.AsyncClient) -> str:
        # Le jeton dure 25 minutes : on le garde tant qu'il est valide.
        if self._token and time.monotonic() < self._token_expires_at:
            return self._token

        response = await client.post(
            TOKEN_URL,
            params={"realm": "/partenaire"},
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "scope": SCOPE,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        payload = response.json()

        self._token = payload["access_token"]
        self._token_expires_at = time.monotonic() + float(payload.get("expires_in", 1400)) - 60
        return self._token

    def _params(self, query: SearchQuery, start: int = 0) -> dict:
        end = start + min(query.limit - start, PER_CALL) - 1
        params: dict[str, str] = {"range": f"{start}-{max(start, end)}"}
        if query.text:
            params["motsCles"] = query.text
        if query.location:
            # L'API attend un code commune/département ; un code postal ou un
            # numéro de département fonctionne, un nom de ville non.
            digits = "".join(char for char in query.location if char.isdigit())
            if len(digits) >= 2:
                params["departement"] = digits[:2]

        codes = [
            code
            for code, value in (
                ("CDI", "cdi"),
                ("CDD", "cdd"),
                ("MIS", "cdd"),
                ("SAI", "stage"),
            )
            if value in query.contract_types
        ]
        if codes:
            params["typeContrat"] = ",".join(dict.fromkeys(codes))
        return params

    async def search(self, query: SearchQuery) -> list[NormalizedOffer]:
        results: list[dict] = []

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            token = await self._access_token(client)

            # Au-delà de 150 offres, il faut enchaîner les plages.
            for start in range(0, max(1, query.limit), PER_CALL):
                response = await client.get(
                    SEARCH_URL,
                    params=self._params(query, start),
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                )
                # 204 = aucun résultat ; 206 = plage partielle, donc la dernière.
                if response.status_code == 204:
                    break
                response.raise_for_status()

                batch = response.json().get("resultats", [])
                results.extend(batch)
                if len(batch) < PER_CALL:
                    break

        results = results[: max(1, query.limit)]
        offers: list[NormalizedOffer] = []
        for item in results:
            description = clean_html(item.get("description", ""))
            contract_code = item.get("typeContrat", "")
            offers.append(
                NormalizedOffer(
                    title=item.get("intitule", "").strip(),
                    company=(item.get("entreprise") or {}).get("nom", "") or "",
                    location=(item.get("lieuTravail") or {}).get("libelle", "") or "",
                    source=self.name,
                    sourceUrl=(item.get("origineOffre") or {}).get("urlOrigine", "") or "",
                    externalId=str(item.get("id", "")),
                    description=description,
                    contractType=_CONTRACT_MAP.get(
                        contract_code, guess_contract(item.get("typeContratLibelle", ""))
                    ),
                    remote=guess_remote(item.get("intitule", ""), description),
                    salary=(item.get("salaire") or {}).get("libelle", "") or "",
                )
            )
        return offers
