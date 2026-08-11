import json
import os
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session", autouse=True)
def force_offline_provider():
    """Aucun test ne doit appeler un LLM : tout tourne en mode déterministe."""
    os.environ["AI_PROVIDER"] = "offline"
    os.environ.pop("ANTHROPIC_API_KEY", None)

    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def sample_payload() -> dict:
    return json.loads((FIXTURES / "sample.json").read_text(encoding="utf-8"))


@pytest.fixture()
def sample_offer(sample_payload):
    from app.schemas import OfferIn

    return OfferIn.model_validate(sample_payload["offer"])


@pytest.fixture()
def sample_profile(sample_payload):
    from app.schemas import ProfileIn

    return ProfileIn.model_validate(sample_payload["profile"])


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
