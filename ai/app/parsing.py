"""Texte d'un CV → rubriques structurées.

Le dépôt d'un CV ne rendait que du texte brut : l'aperçu de l'onglet « Mon CV »
se construisant depuis les rubriques, un import ne changeait rien à l'écran et
la mise en page du CV déposé était perdue.

Extraire les rubriques permet de garder **un seul gabarit** — celui que la
personne a conçu — et de n'en remplacer que le contenu. Le CV importé n'est plus
un document rival, c'est une source de données.
"""

import json
import logging

from .cv_sections import parse_cv_sections

logger = logging.getLogger(__name__)

# Le schéma reprend les champs de `ProfileIn` : ce qui en sort est directement
# assignable au profil, sans traduction intermédiaire qui dériverait.
PARSE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "fullName": {"type": "string"},
        "headline": {"type": "string", "description": "Intitulé de poste."},
        "email": {"type": "string"},
        "phone": {"type": "string"},
        "location": {"type": "string"},
        "summary": {"type": "string", "description": "Le paragraphe d'accroche."},
        "skillGroups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "items": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["label", "items"],
                "additionalProperties": False,
            },
        },
        "experiences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "role": {"type": "string"},
                    "company": {"type": "string"},
                    "location": {"type": "string"},
                    "startDate": {"type": "string", "description": "AAAA-MM-JJ si connue."},
                    "endDate": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["role", "company", "bullets"],
                "additionalProperties": False,
            },
        },
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "degree": {"type": "string"},
                    "school": {"type": "string"},
                    "location": {"type": "string"},
                    "startDate": {"type": "string"},
                    "endDate": {"type": "string"},
                    "details": {"type": "string"},
                },
                "required": ["degree", "school"],
                "additionalProperties": False,
            },
        },
        "projects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "startDate": {"type": "string"},
                    "endDate": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "bullets"],
                "additionalProperties": False,
            },
        },
        "languages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "level": {"type": "string"}},
                "required": ["name"],
                "additionalProperties": False,
            },
        },
        "interests": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["fullName", "skillGroups", "experiences", "education"],
    "additionalProperties": False,
}

PARSE_SYSTEM = """\
Tu extrais les rubriques d'un CV. Tu ne réécris rien, tu ne reformules rien, tu
n'inventes rien : tu ranges ce qui est écrit dans les bons champs.

RÈGLES
- Reprends les libellés et les formulations du document tels quels.
- Une information absente reste absente : chaîne vide ou liste vide, jamais une
  valeur plausible que tu aurais devinée.
- Les dates au format AAAA-MM-JJ quand elles sont lisibles ; sinon, chaîne vide.
- Regroupe les compétences comme le CV les regroupe (« Langages », « Bases de
  données »…). S'il n'y a aucun regroupement, fais un seul groupe « Compétences ».
- Toutes les expériences et formations du document doivent apparaître, sans
  exception et dans leur ordre d'origine.
"""


def _raison_lisible(exc: Exception) -> str:
    """Ce qui s'est réellement passé, dit à quelqu'un qui n'a pas les journaux.

    « Moteur IA indisponible » couvrait sans distinction une clé absente, un
    crédit épuisé et une panne réseau — trois situations qui n'appellent pas du
    tout la même réaction. On nomme celles qu'on sait reconnaître.
    """
    message = str(exc)
    if "credit balance is too low" in message:
        return (
            "Le compte Anthropic n'a plus de crédit : les rubriques ont été "
            "reconnues sans le modèle, à relire."
        )
    if "rate_limit" in message or "429" in message:
        return (
            "Le moteur est momentanément saturé : les rubriques ont été reconnues "
            "sans lui, à relire."
        )
    if "authentication" in message.lower() or "401" in message:
        return (
            "La clé du moteur IA est refusée : les rubriques ont été reconnues "
            "sans le modèle, à relire."
        )
    return "Le moteur IA n'a pas répondu : les rubriques ont été reconnues sans lui, à relire."


async def parse_cv(provider, text: str, *, max_chars: int = 24000) -> tuple[dict | None, str]:
    """Rubriques d'un CV, et la façon dont on les a obtenues.

    Rend `(champs, methode)` où `methode` vaut « modele », « heuristique » ou un
    message expliquant l'échec. L'appelant n'a plus à deviner : jusqu'ici, tout
    échec rendait `None` et l'écran parlait de « moteur indisponible », que la
    clé soit absente, le crédit épuisé ou le service en panne.

    Le repli sans modèle vaut mieux que rien : moins fin, mais hors ligne et
    toujours disponible. Un import qui ne remplit aucune rubrique est vécu comme
    un import raté, et c'est exactement ce qui se produisait.
    """
    client = getattr(provider, "_client", None)
    if client is None:
        return parse_cv_sections(text), "heuristique"

    try:
        response = await client.messages.create(
            model=provider.model,
            max_tokens=8000,
            system=[{"type": "text", "text": PARSE_SYSTEM}],
            messages=[{"role": "user", "content": text[:max_chars]}],
            output_config={
                "effort": "low",  # rangement, pas raisonnement : le bas suffit
                "format": {"type": "json_schema", "schema": PARSE_SCHEMA},
            },
        )
    except Exception as exc:
        logger.warning("extraction structurée impossible : %s", exc)
        return parse_cv_sections(text), _raison_lisible(exc)

    if getattr(response, "stop_reason", None) in {"refusal", "max_tokens"}:
        logger.warning("extraction structurée interrompue : %s", response.stop_reason)
        return parse_cv_sections(text), "Le modèle n'a pas pu terminer : rubriques reconnues sans lui, à relire."

    brut = "".join(
        block.text for block in response.content if getattr(block, "type", "") == "text"
    ).strip()

    try:
        return json.loads(brut), "modele"
    except json.JSONDecodeError:
        logger.warning("réponse du modèle illisible en JSON")
        return parse_cv_sections(text), "Réponse du modèle illisible : rubriques reconnues sans lui, à relire."
