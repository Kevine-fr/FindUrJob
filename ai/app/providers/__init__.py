"""Sélection du fournisseur à partir de la configuration."""

import logging

from ..config import Settings
from .base import Generation, Provider, ProviderError
from .offline import OfflineProvider

logger = logging.getLogger(__name__)

__all__ = ["Generation", "Provider", "ProviderError", "OfflineProvider", "build_provider"]


def build_provider(settings: Settings) -> Provider:
    """Instancie le fournisseur résolu ; retombe sur `offline` en cas de souci."""
    resolved = settings.resolved_provider

    if resolved == "anthropic":
        try:
            from .anthropic_provider import AnthropicProvider

            return AnthropicProvider(settings)
        except Exception as exc:  # SDK absent, clé invalide au constructeur…
            logger.error(
                "fournisseur anthropic indisponible (%s) — bascule en mode hors-ligne", exc
            )
            return OfflineProvider()

    return OfflineProvider()
