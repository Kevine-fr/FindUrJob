"""Chemin LLM, avec un client factice : aucun appel réseau, aucune clé.

On vérifie ce qui se passe *autour* de l'appel : la requête envoyée, le parsing
de la réponse structurée, et le comportement sur refus, troncature ou panne.
"""

import asyncio
import json

import pytest


def run(coro):
    """Exécute une coroutine sans dépendre d'un plugin pytest asynchrone."""
    return asyncio.run(coro)

from app.config import Settings
from app.keywords import extract_keywords
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import ProviderError


class _Block:
    def __init__(self, type_: str, text: str = "") -> None:
        self.type = type_
        self.text = text


class _Response:
    def __init__(self, blocks, stop_reason="end_turn") -> None:
        self.content = blocks
        self.stop_reason = stop_reason
        self.usage = None


class _FakeMessages:
    def __init__(self, response=None, error=None) -> None:
        self._response = response
        self._error = error
        self.last_kwargs: dict | None = None

    async def create(self, **kwargs):
        self.last_kwargs = kwargs
        if self._error is not None:
            raise self._error
        return self._response


class _FakeClient:
    def __init__(self, response=None, error=None) -> None:
        self.messages = _FakeMessages(response, error)
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def _provider(response=None, error=None) -> AnthropicProvider:
    settings = Settings(anthropic_api_key="test-key", ai_provider="anthropic")
    provider = AnthropicProvider(settings)
    provider._client = _FakeClient(response, error)  # noqa: SLF001 - injection de test
    return provider


def _valid_response() -> _Response:
    payload = {
        "content": "# Camille Dupont\n\n## Compétences\nNode.js, React",
        "coverLetter": "Objet : Candidature\n\nMadame, Monsieur,\n\nCordialement,\nCamille",
        "keywords": ["Node.js", "React"],
    }
    return _Response([_Block("thinking"), _Block("text", json.dumps(payload, ensure_ascii=False))])


def test_reponse_structuree_parsee(sample_offer, sample_profile):
    provider = _provider(_valid_response())

    generation = run(
        provider.generate(
            offer=sample_offer, profile=sample_profile, keywords=extract_keywords(sample_offer)
        )
    )

    assert generation.content.startswith("# Camille Dupont")
    assert "Cordialement" in generation.cover_letter
    assert generation.keywords == ["Node.js", "React"]


def test_requete_bien_formee(sample_offer, sample_profile):
    provider = _provider(_valid_response())
    run(
        provider.generate(
            offer=sample_offer, profile=sample_profile, keywords=extract_keywords(sample_offer)
        )
    )

    sent = provider._client.messages.last_kwargs  # noqa: SLF001
    assert sent["model"] == "claude-opus-5"
    # Le cache est un préfixe : la césure se pose sur le DERNIER bloc stable,
    # et couvre alors tout ce qui précède — consignes puis dossier du candidat.
    # La marquer sur le premier bloc ne mettrait en cache que les consignes.
    assert "n'invente aucun fait" in sent["system"][0]["text"]
    assert "cache_control" not in sent["system"][0]
    assert sent["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "Camille Dupont" in sent["system"][-1]["text"]
    # Sortie contrainte par schéma, pas de Markdown à deviner.
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert sent["output_config"]["effort"] == "medium"
    # Le message utilisateur ne porte que l'offre — la partie qui change à
    # chaque appel. Y remettre le profil le sortirait du préfixe caché et ferait
    # repayer le dossier du candidat en entier à chaque candidature.
    user_prompt = sent["messages"][0]["content"]
    assert "Atelier Numérique" in user_prompt
    assert "Camille Dupont" not in user_prompt


def test_refus_du_modele(sample_offer, sample_profile):
    provider = _provider(_Response([_Block("text", "")], stop_reason="refusal"))

    with pytest.raises(ProviderError, match="refus"):
        run(provider.generate(offer=sample_offer, profile=sample_profile, keywords=[]))


def test_reponse_tronquee(sample_offer, sample_profile):
    provider = _provider(_Response([_Block("text", '{"content": "…')], stop_reason="max_tokens"))

    with pytest.raises(ProviderError, match="tronqu"):
        run(provider.generate(offer=sample_offer, profile=sample_profile, keywords=[]))


def test_json_invalide(sample_offer, sample_profile):
    provider = _provider(_Response([_Block("text", "désolé, voici du texte libre")]))

    with pytest.raises(ProviderError, match="schéma JSON"):
        run(provider.generate(offer=sample_offer, profile=sample_profile, keywords=[]))


def test_panne_reseau(sample_offer, sample_profile):
    provider = _provider(error=RuntimeError("connexion refusée"))

    with pytest.raises(ProviderError, match="impossible"):
        run(provider.generate(offer=sample_offer, profile=sample_profile, keywords=[]))


def test_echec_llm_bascule_sur_le_brouillon_deterministe(
    client, sample_payload, monkeypatch
):
    """Bout en bout : le moteur ne renvoie jamais d'erreur à l'API Node."""

    async def boom(**_kwargs):
        raise ProviderError("quota dépassé")

    monkeypatch.setattr(client.app.state.provider, "generate", boom)

    response = client.post("/tailor", json=sample_payload)
    assert response.status_code == 200

    body = response.json()
    assert body["content"].strip()
    assert body["meta"]["provider"] == "offline"
    assert any("indisponible" in warning for warning in body["meta"]["warnings"])
