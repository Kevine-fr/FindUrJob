"""API du moteur IA de reciblage — FindUrJob.

Contrat attendu par `api/src/services/tailoringService.js` :

    POST /tailor
      entrée : { offer, profile }
      sortie : { content, coverLetter, score, keywords }

`meta` est ajouté en supplément (provider, avertissements, détail du score) ;
le serveur Node l'ignore, mais il rend le service débuggable en production.
"""

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from .config import get_settings
from .cv_extract import UnsupportedFile, extract
from .guards import inspect, is_usable
from .keywords import Keyword, extract_keywords
from .parsing import parse_cv
from .providers import ProviderError, build_provider
from .providers.offline import OfflineProvider
from .rendering import render_master_cv
from .schemas import (
    ComposeCvRequest,
    ComposeCvResponse,
    ExtractCvResponse,
    HealthResponse,
    SearchRequest,
    SearchResponse,
    TailorMeta,
    ScoreResponse,
    TailorRequest,
    TailorResponse,
)
from .sources import SearchQuery, build_sources, search_all
from .scoring import compute_score
from .textutils import stem_text

VERSION = "1.0.0"

logger = logging.getLogger("findurjob.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    app.state.settings = settings
    app.state.provider = build_provider(settings)
    app.state.fallback = OfflineProvider()
    app.state.sources = build_sources(settings)

    logger.info(
        "moteur IA prêt — fournisseur=%s modèle=%s sources=%s",
        app.state.provider.name,
        app.state.provider.model,
        ", ".join(source.name for source in app.state.sources) or "aucune",
    )
    if not settings.uses_llm:
        logger.warning(
            "aucune clé API configurée : les brouillons sont générés en mode déterministe"
        )

    try:
        yield
    finally:
        await app.state.provider.aclose()


app = FastAPI(
    title="FindUrJob — moteur IA de reciblage",
    description="Recible un CV et rédige une lettre à partir d'une offre et d'un profil.",
    version=VERSION,
    lifespan=lifespan,
)


@app.exception_handler(Exception)
async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
    logger.exception("erreur non gérée")
    return JSONResponse(
        status_code=500,
        content={"error": f"erreur interne du moteur IA ({type(exc).__name__})"},
    )


@app.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    provider = request.app.state.provider
    return HealthResponse(
        status="ok",
        provider=provider.name,
        model=provider.model,
        llm=settings.uses_llm,
        version=VERSION,
        sources=[source.name for source in request.app.state.sources],
    )


@app.post("/compose-cv", response_model=ComposeCvResponse)
async def compose_cv(payload: ComposeCvRequest, request: Request) -> ComposeCvResponse:
    """Assemble un CV Markdown à partir des champs saisis dans le formulaire.

    Déterministe : aucun appel au modèle. C'est le CV « source », celui qui sera
    ensuite réécrit par offre.
    """
    profile = payload.profile
    markdown = render_master_cv(profile)
    return ComposeCvResponse(content=markdown, chars=len(markdown))


@app.post("/search", response_model=SearchResponse)
async def search(payload: SearchRequest, request: Request) -> SearchResponse:
    """Cherche des offres sur les sources configurées et les normalise."""
    started = time.perf_counter()
    sources = request.app.state.sources

    query = SearchQuery(
        keywords=payload.keywords,
        location=payload.location,
        contract_types=payload.contractTypes,
        remotes=payload.remotes,
        limit=payload.limit,
    )
    offers, report = await search_all(sources, query, only=payload.sources or None)

    logger.info(
        "recherche — mots-clés=%r lieu=%r → %s offre(s) en %sms (%s)",
        query.text,
        query.location,
        len(offers),
        int((time.perf_counter() - started) * 1000),
        report,
    )
    return SearchResponse(
        offers=[offer.to_dict() for offer in offers],
        total=len(offers),
        sources=report,
    )


@app.post("/extract-cv", response_model=ExtractCvResponse)
async def extract_cv(request: Request, file: UploadFile = File(...)) -> ExtractCvResponse:
    """Texte d'un CV déposé (PDF, DOCX, TXT, MD). Le fichier n'est pas conservé."""
    settings = request.app.state.settings
    data = await file.read()

    if len(data) > settings.ai_max_cv_bytes:
        limit_mb = settings.ai_max_cv_bytes / (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Fichier trop lourd (max {limit_mb:.0f} Mo)")

    try:
        result = extract(file.filename or "", data)
    except UnsupportedFile as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    logger.info(
        "CV extrait — fichier=%r pages=%s caractères=%s alertes=%s",
        file.filename,
        result.pages,
        len(result.text),
        len(result.warnings),
    )
    return ExtractCvResponse(
        text=result.text,
        chars=len(result.text),
        pages=result.pages,
        filename=file.filename or "",
        warnings=result.warnings,
        # Rubriques structurées : c’est ce qui permet de garder le gabarit du
        # CV conçu ici et de n’en remplacer que les données. `None` quand le
        # moteur est hors-ligne ou que l’extraction n’aboutit pas : l’appelant
        # conserve alors le texte brut plutôt que de perdre l’import.
        fields=await parse_cv(request.app.state.provider, result.text),
    )


def _merge_keywords(extracted: list[Keyword], suggested: list[str], limit: int) -> list[str]:
    """Mots-clés extraits d'abord, complétés par les suggestions inédites du modèle.

    La déduplication se fait sur la forme canonique : « CI-CD » et « CI/CD » ne
    doivent pas occuper deux places dans la liste.
    """
    merged: list[str] = []
    seen: set[str] = set()
    for term in [kw.term for kw in extracted] + suggested:
        key = stem_text(term)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(term.strip())
        if len(merged) >= limit:
            break
    return merged


@app.post("/score", response_model=ScoreResponse)
async def score(payload: TailorRequest, request: Request) -> ScoreResponse:
    """Score une offre sans rien generer.

    Meme entree que /tailor, mais aucun appel au modele : le calcul est local
    et prend quelques millisecondes. La campagne s’en sert pour ecarter les
    offres sous le seuil avant de payer une generation qu’elle jetterait.
    """
    settings = request.app.state.settings
    keywords = extract_keywords(payload.offer, limit=max(settings.ai_max_keywords, 24))
    scored = compute_score(payload.offer, payload.profile, keywords)
    return ScoreResponse(
        score=scored.score,
        keywords=[kw.term for kw in keywords],
        breakdown=scored.breakdown,
    )


@app.post("/tailor", response_model=TailorResponse)
async def tailor(payload: TailorRequest, request: Request) -> TailorResponse:
    started = time.perf_counter()
    settings = request.app.state.settings
    provider = request.app.state.provider
    fallback = request.app.state.fallback

    offer = payload.offer
    profile = payload.profile

    keywords = extract_keywords(offer, limit=max(settings.ai_max_keywords, 24))
    scored = compute_score(offer, profile, keywords)

    warnings: list[str] = []
    generation = None

    try:
        generation = await provider.generate(offer=offer, profile=profile, keywords=keywords)
        if not is_usable(generation.content, generation.cover_letter):
            warnings.append("Sortie du modèle incomplète : brouillon déterministe utilisé.")
            generation = None
    except ProviderError as exc:
        logger.warning("génération en échec : %s", exc)
        warnings.append(
            f"Moteur IA indisponible ({str(exc)[:200]}) : brouillon déterministe utilisé."
        )

    used_provider = provider.name
    used_model = provider.model
    if generation is None:
        generation = await fallback.generate(offer=offer, profile=profile, keywords=keywords)
        used_provider = fallback.name
        used_model = fallback.model

    warnings.extend(inspect(generation.content, generation.cover_letter, profile))
    if not keywords:
        warnings.append("Aucun mot-clé exploitable dans l'offre : score peu significatif.")

    duration_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "reciblage — offre=%r fournisseur=%s score=%s mots-clés=%s durée=%sms alertes=%s",
        offer.title or "(sans titre)",
        used_provider,
        scored.score,
        len(keywords),
        duration_ms,
        len(warnings),
    )

    return TailorResponse(
        content=generation.content,
        coverLetter=generation.cover_letter,
        score=scored.score,
        keywords=_merge_keywords(keywords, generation.keywords, settings.ai_max_keywords),
        meta=TailorMeta(
            provider=used_provider,
            model=used_model,
            generatedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            durationMs=duration_ms,
            warnings=warnings,
            scoreBreakdown=scored.breakdown,
        ),
    )
