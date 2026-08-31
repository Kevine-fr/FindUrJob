"""Schémas d'entrée/sortie du moteur.

L'entrée vient directement de Mongo via l'API Node : elle peut contenir des
champs en trop (`_id`, `createdAt`…), des valeurs `null` ou des sous-objets
manquants. Tout est donc optionnel et coercé — un profil vide doit produire
un brouillon pauvre, jamais une erreur 422.
"""

from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

# --- Coercions tolérantes ----------------------------------------------


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    return ""


def _as_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple, set)):
        return [text for text in (_as_text(item) for item in value) if text]
    return []


def _as_object(value: Any) -> Any:
    """`null` ou scalaire → objet vide, pour que les défauts s'appliquent."""
    return value if isinstance(value, (dict, BaseModel)) else {}


def _as_object_list(value: Any) -> list[Any]:
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value if isinstance(item, (dict, BaseModel))]


Text = Annotated[str, BeforeValidator(_as_text)]
TextList = Annotated[list[str], BeforeValidator(_as_text_list)]


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore")


# --- Entrée -------------------------------------------------------------


def _as_links(value: Any) -> list[Any]:
    """Accepte la forme historique {github: url} comme la forme actuelle [{type, url}]."""
    if isinstance(value, dict):
        return [{"type": key, "url": url} for key, url in value.items() if _as_text(url)]
    return _as_object_list(value)


class _Shipped(_Lenient):
    """Une réalisation publiée : son lien, et sa présence sur les magasins."""

    appUrl: Text = ""
    onAppStore: bool = False
    onPlayStore: bool = False


class _WithFacts(_Shipped):
    """Une entrée de parcours : ce qu'elle raconte tient dans ses puces."""

    bullets: TextList = []
    description: Text = ""

    @property
    def facts(self) -> list[str]:
        """Les puces, ou à défaut le paragraphe découpé ligne à ligne."""
        if self.bullets:
            return self.bullets
        return [
            line.strip(" -•\t") for line in self.description.splitlines() if line.strip(" -•\t")
        ]


class ExperienceIn(_WithFacts):
    role: Text = ""
    company: Text = ""
    location: Text = ""
    period: Text = ""


class EducationIn(_Shipped):
    degree: Text = ""
    school: Text = ""
    location: Text = ""
    period: Text = ""
    detail: Text = ""


class ProjectIn(_WithFacts):
    name: Text = ""
    role: Text = ""
    company: Text = ""
    location: Text = ""
    period: Text = ""
    url: Text = ""


class CertificationIn(_Lenient):
    name: Text = ""
    issuer: Text = ""
    date: Text = ""
    url: Text = ""


class LanguageIn(_Lenient):
    name: Text = ""
    level: Text = ""


class LinkIn(_Lenient):
    type: Text = "autre"
    url: Text = ""
    label: Text = ""


class SkillGroupIn(_Lenient):
    label: Text = ""
    items: TextList = []


class ProfileIn(_Lenient):
    fullName: Text = ""
    headline: Text = ""
    email: Text = ""
    phone: Text = ""
    location: Text = ""
    summary: Text = ""
    skills: TextList = []
    skillGroups: Annotated[list[SkillGroupIn], BeforeValidator(_as_object_list)] = []
    experiences: Annotated[list[ExperienceIn], BeforeValidator(_as_object_list)] = []
    education: Annotated[list[EducationIn], BeforeValidator(_as_object_list)] = []
    projects: Annotated[list[ProjectIn], BeforeValidator(_as_object_list)] = []
    certifications: Annotated[list[CertificationIn], BeforeValidator(_as_object_list)] = []
    languages: Annotated[list[LanguageIn], BeforeValidator(_as_object_list)] = []
    interests: TextList = []
    links: Annotated[list[LinkIn], BeforeValidator(_as_links)] = []
    masterCv: Text = ""

    @property
    def all_skills(self) -> list[str]:
        """Liste à plat : compétences groupées d'abord, puis la liste simple."""
        merged: list[str] = []
        seen: set[str] = set()
        for skill in [item for group in self.skillGroups for item in group.items] + self.skills:
            key = skill.casefold()
            if key and key not in seen:
                seen.add(key)
                merged.append(skill)
        return merged


class OfferIn(_Lenient):
    title: Text = ""
    company: Text = ""
    location: Text = ""
    source: Text = ""
    sourceUrl: Text = ""
    description: Text = ""
    contractType: Text = ""
    remote: Text = ""
    salary: Text = ""
    keywords: TextList = []


class TailorRequest(_Lenient):
    offer: Annotated[OfferIn, BeforeValidator(_as_object)] = Field(default_factory=OfferIn)
    profile: Annotated[ProfileIn, BeforeValidator(_as_object)] = Field(default_factory=ProfileIn)


# --- Sortie -------------------------------------------------------------


class ScoreBreakdown(BaseModel):
    """Détail du score, pour pouvoir l'expliquer plutôt que l'asséner."""

    skills: int = 0
    title: int = 0
    seniority: int = 0
    location: int = 0
    matchedKeywords: list[str] = []
    missingKeywords: list[str] = []


class TailorMeta(BaseModel):
    provider: str
    model: str
    generatedAt: str
    durationMs: int = 0
    warnings: list[str] = []
    scoreBreakdown: ScoreBreakdown = Field(default_factory=ScoreBreakdown)


class ScoreResponse(BaseModel):
    """Score seul, sans generation.

    Le score est deterministe : il ne depend que de l’offre, du profil et des
    mots-cles extraits. Le calculer sans appeler le modele permet d’ecarter les
    offres sous le seuil avant d’engager la moindre depense — c’est l’essentiel
    de l’economie sur une campagne.
    """

    score: int
    keywords: list[str]
    breakdown: ScoreBreakdown


class TailorResponse(BaseModel):
    """Contrat attendu par `api/src/services/tailoringService.js`.

    `content`, `coverLetter`, `score` et `keywords` sont obligatoires ; `meta`
    est un supplément non contractuel que le serveur Node ignore.
    """

    content: str
    coverLetter: str
    score: int
    keywords: list[str]
    meta: TailorMeta


class ComposeCvRequest(_Lenient):
    """Champs du formulaire « Créer mon CV »."""

    profile: Annotated[ProfileIn, BeforeValidator(_as_object)] = Field(default_factory=ProfileIn)


class ComposeCvResponse(BaseModel):
    content: str
    chars: int


class SearchRequest(_Lenient):
    """Recherche d'offres sur les sources configurées."""

    keywords: TextList = []
    location: Text = ""
    contractTypes: TextList = []
    remotes: TextList = []
    sources: TextList = []  # vide = toutes les sources disponibles
    limit: int = 25


class SearchResponse(BaseModel):
    offers: list[dict]
    total: int
    sources: dict[str, str]  # ce que chaque source a renvoyé, ou son échec


class ExtractCvResponse(BaseModel):
    """Résultat du dépôt d'un CV : seul le texte est conservé."""

    text: str
    chars: int
    pages: int = 0
    filename: str = ""
    warnings: list[str] = []
    # Rubriques reconnues dans le document, quand le moteur a pu les extraire.
    fields: dict | None = None
    # Comment elles l'ont été : « modele », « heuristique », ou la raison pour
    # laquelle le modèle n'a pas pu servir. L'écran s'en sert pour dire s'il faut
    # relire, et pourquoi — « moteur indisponible » ne disait rien d'actionnable.
    parseMethod: str = ""


class HealthResponse(BaseModel):
    status: str
    provider: str
    model: str
    llm: bool
    version: str
    sources: list[str] = []
