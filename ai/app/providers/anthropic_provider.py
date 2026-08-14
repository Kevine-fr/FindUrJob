"""Fournisseur Anthropic (SDK officiel).

La sortie est contrainte par un JSON Schema (`output_config.format`) : pas de
parsing fragile de Markdown, et un contrat stable pour l'API Node.
Le prompt système est constant et marqué en cache : à partir de la deuxième
candidature, il n'est plus refacturé au prix plein.
"""

import json
import logging

from anthropic import AsyncAnthropic

from ..config import Settings
from ..keywords import Keyword
from ..prompts import SYSTEM_PROMPT, build_user_prompt
from ..schemas import OfferIn, ProfileIn
from .base import Generation, ProviderError

logger = logging.getLogger(__name__)

TAILOR_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "content": {
            "type": "string",
            "description": "CV reciblé, en Markdown et en français.",
        },
        "coverLetter": {
            "type": "string",
            "description": "Lettre de motivation, texte brut, français, 250 mots max.",
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Termes de l'offre ayant guidé le reciblage.",
        },
    },
    "required": ["content", "coverLetter", "keywords"],
    "additionalProperties": False,
}


def explain_failure(exc: Exception) -> str:
    """Traduit l'échec en une phrase qui dit quoi faire.

    Ne remonter que le nom de la classe d'exception — `BadRequestError` — donnait
    un message qui ressemblait à une panne de l'application alors que la cause
    était administrative, et laissait croire pendant des jours que le moteur
    tournait mal. La cause exacte se lit dans le corps renvoyé par l'API : on la
    fait remonter, traduite quand on la reconnaît.
    """
    detail = str(getattr(exc, "message", "") or exc)

    # Les cas qu'on sait nommer, du plus fréquent au plus rare.
    reconnus = [
        ("credit balance is too low",
         "crédits Anthropic épuisés — recharge le compte sur console.anthropic.com "
         "(Plans & Billing). La clé est valide, mais aucun appel ne peut aboutir."),
        ("invalid x-api-key",
         "clé API refusée : vérifie ANTHROPIC_API_KEY dans ai/.env."),
        ("authentication",
         "authentification refusée : vérifie ANTHROPIC_API_KEY dans ai/.env."),
        ("rate_limit",
         "limite de débit atteinte : réessaie dans quelques instants."),
        ("not_found_error",
         f"modèle « {getattr(exc, 'model', '')} » inconnu : vérifie AI_MODEL dans ai/.env."),
        ("overloaded",
         "service Anthropic momentanément surchargé : réessaie dans quelques instants."),
    ]
    minuscule = detail.lower()
    for motif, message in reconnus:
        if motif in minuscule:
            return message

    # Inconnu : on rend le message brut de l'API plutôt qu'un nom de classe.
    return f"appel au modèle impossible — {detail[:300] or type(exc).__name__}"


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.model = settings.ai_model
        self._client = AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.ai_timeout_seconds,
            max_retries=settings.ai_max_retries,
        )

    async def generate(
        self,
        *,
        offer: OfferIn,
        profile: ProfileIn,
        keywords: list[Keyword],
    ) -> Generation:
        user_prompt = build_user_prompt(
            offer,
            profile,
            keywords,
            max_description_chars=self._settings.ai_max_description_chars,
            max_cv_chars=self._settings.ai_max_cv_chars,
        )

        try:
            response = await self._client.messages.create(
                model=self.model,
                max_tokens=self._settings.ai_max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_prompt}],
                output_config={
                    "effort": self._settings.ai_effort,
                    "format": {"type": "json_schema", "schema": TAILOR_SCHEMA},
                },
            )
        except Exception as exc:  # réseau, quota, authentification, paramètre refusé…
            logger.warning("échec de l'appel au modèle %s : %s", self.model, exc)
            raise ProviderError(explain_failure(exc)) from exc

        stop_reason = getattr(response, "stop_reason", None)
        if stop_reason == "refusal":
            raise ProviderError("le modèle a refusé de traiter cette demande")
        if stop_reason == "max_tokens":
            raise ProviderError("réponse tronquée (max_tokens) : augmente AI_MAX_TOKENS")

        # Les blocs de raisonnement précèdent le texte : on ne garde que le texte.
        text = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        ).strip()
        if not text:
            raise ProviderError("réponse vide du modèle")

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"réponse non conforme au schéma JSON ({exc})") from exc

        usage = getattr(response, "usage", None)
        if usage is not None:
            logger.info(
                "génération anthropic ok",
                extra={
                    "model": self.model,
                    "input_tokens": getattr(usage, "input_tokens", None),
                    "output_tokens": getattr(usage, "output_tokens", None),
                    "cache_read": getattr(usage, "cache_read_input_tokens", None),
                },
            )

        raw_keywords = payload.get("keywords") or []
        return Generation(
            content=str(payload.get("content") or "").strip(),
            cover_letter=str(payload.get("coverLetter") or "").strip(),
            keywords=[str(item).strip() for item in raw_keywords if str(item).strip()],
        )

    async def aclose(self) -> None:
        await self._client.close()
