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


async def parse_cv(provider, text: str, *, max_chars: int = 24000):
    """Rend un dictionnaire de rubriques, ou `None` si l'extraction n'aboutit pas.

    `None` plutôt qu'une exception : l'appelant garde alors le texte brut, qui
    reste utile, au lieu de perdre l'import entier.
    """
    client = getattr(provider, "_client", None)
    if client is None:
        return None  # mode hors-ligne : pas d'extraction structurée

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
        return None

    if getattr(response, "stop_reason", None) in {"refusal", "max_tokens"}:
        return None

    brut = "".join(
        block.text for block in response.content if getattr(block, "type", "") == "text"
    ).strip()

    try:
        return json.loads(brut)
    except json.JSONDecodeError:
        return None
