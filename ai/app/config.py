"""Configuration du moteur IA, entièrement pilotée par variables d'environnement.

Aucune clé n'est écrite dans le code ni dans le dépôt : elles arrivent par
l'environnement (ou un fichier `.env` local, ignoré par git).
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["auto", "anthropic", "offline"]
EffortLevel = Literal["low", "medium", "high", "xhigh", "max"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Fournisseur ---------------------------------------------------
    # "auto" : Anthropic si une clé est présente, sinon repli déterministe.
    ai_provider: ProviderName = "auto"
    anthropic_api_key: str = ""

    # --- Paramètres du modèle ------------------------------------------
    ai_model: str = "claude-opus-5"
    ai_effort: EffortLevel = "medium"
    ai_max_tokens: int = 8000
    ai_timeout_seconds: float = 90.0
    ai_max_retries: int = 2

    # --- Garde-fous d'entrée -------------------------------------------
    # Une annonce copiée-collée peut être énorme : on tronque avant l'envoi.
    ai_max_description_chars: int = 12000
    # Le CV source part en entier dans le prompt : il est la matière à réécrire.
    ai_max_cv_chars: int = 24000
    # Taille maximale d'un fichier de CV déposé (octets).
    ai_max_cv_bytes: int = 5 * 1024 * 1024
    # Nombre de mots-clés renvoyés dans la réponse.
    ai_max_keywords: int = 20

    # --- Sources d'offres ----------------------------------------------
    # France Travail : inscription gratuite sur https://francetravail.io
    france_travail_client_id: str = ""
    france_travail_client_secret: str = ""
    # Adzuna : inscription gratuite sur https://developer.adzuna.com
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    adzuna_country: str = "fr"
    # Remotive ne demande aucune clé : toujours disponible.
    search_timeout_seconds: float = 20.0

    log_level: str = "info"

    @property
    def resolved_provider(self) -> Literal["anthropic", "offline"]:
        """Fournisseur réellement utilisé, une fois `auto` tranché."""
        if self.ai_provider == "auto":
            return "anthropic" if self.anthropic_api_key.strip() else "offline"
        return self.ai_provider

    @property
    def uses_llm(self) -> bool:
        return self.resolved_provider != "offline"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
