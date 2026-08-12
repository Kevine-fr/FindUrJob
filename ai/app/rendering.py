"""Rendu déterministe du CV et de la lettre (Markdown, en français).

Sert deux fois : c'est la sortie du mode hors-ligne, et le filet de sécurité
quand le LLM échoue ou renvoie quelque chose d'inexploitable. Il ne réécrit
rien — il réorganise et priorise ce que le profil contient déjà.
"""

import re

from .keywords import Keyword
from .schemas import OfferIn, ProfileIn
from .textutils import contains_term, padded, stem_text, strip_accents

_OFFLINE_NOTE = (
    "_Brouillon hors-ligne : réorganisation du profil sans reformulation "
    "(moteur IA non configuré). À relire et compléter._"
)

# Mentions administratives d'un intitulé : inutiles dans un CV ou une lettre.
_GENDER_MENTION_RE = re.compile(
    r"\s*[\(\[]?\s*(?:h\s*/\s*f(?:\s*/\s*x)?|f\s*/\s*h|m\s*/\s*f|w\s*/\s*m)\s*[\)\]]?",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    return re.sub(r"\s{2,}", " ", _GENDER_MENTION_RE.sub("", title)).strip(" -–—·")


def de(word: str) -> str:
    """« de Développeur », mais « d'Ingénieur » : élision devant une voyelle."""
    initial = strip_accents(word.strip())[:1].lower()
    return f"d'{word}" if initial in "aeiouyh" else f"de {word}"


def split_skills(profile: ProfileIn, keywords: list[Keyword]) -> tuple[list[str], list[str]]:
    """Sépare les compétences du profil en « attendues par l'offre » et le reste."""
    wanted = keywords[:14]
    targeted: list[str] = []
    others: list[str] = []

    for skill in profile.all_skills:
        haystack = padded(stem_text(skill))
        if any(contains_term(haystack, kw.norm) for kw in wanted):
            targeted.append(skill)
        else:
            others.append(skill)
    return targeted, others


def _contact_line(profile: ProfileIn) -> str:
    bits = [profile.email, profile.phone, *(link.url for link in profile.links)]
    return " · ".join(bit for bit in bits if bit)


def _experience_block(entry) -> list[str]:
    """Un poste (ou un projet) en Markdown : titre, période, puis les faits en puces."""
    title = getattr(entry, "name", "") or entry.role
    heading = " — ".join(bit for bit in (title, entry.company) if bit) or "Expérience"
    lines = ["", f"### {heading}"]

    context = " · ".join(bit for bit in (entry.period, entry.location) if bit)
    if context:
        lines.append(f"_{context}_")

    facts = entry.facts if hasattr(entry, "facts") else []
    if facts:
        lines.append("")
        lines += [f"- {fact}" for fact in facts]
    elif entry.description:
        lines += ["", entry.description]

    # Application publiée : le lien, et les magasins où on peut la trouver.
    stores = [
        name
        for name, published in (("App Store", entry.onAppStore), ("Play Store", entry.onPlayStore))
        if published
    ]
    if entry.appUrl or stores:
        bits = [entry.appUrl] + ([" · ".join(stores)] if stores else [])
        lines.append(f"_{' — '.join(bit for bit in bits if bit)}_")
    return lines


def render_cv(
    offer: OfferIn,
    profile: ProfileIn,
    keywords: list[Keyword],
    *,
    offline: bool = False,
) -> str:
    name = profile.fullName or "Candidat"
    lines: list[str] = [f"# {name}"]

    subtitle = " · ".join(bit for bit in (profile.headline, profile.location) if bit)
    if subtitle:
        lines.append(f"_{subtitle}_")

    contact = _contact_line(profile)
    if contact:
        lines.append(contact)

    if offline:
        lines += ["", _OFFLINE_NOTE]

    target = clean_title(offer.title) or "le poste visé"
    at_company = f" chez {offer.company}" if offer.company else ""
    lines += ["", f"**Candidature : {target}{at_company}**"]

    if profile.summary:
        lines += ["", "## En bref", "", profile.summary]

    targeted, others = split_skills(profile, keywords)
    if targeted or others:
        lines += ["", "## Compétences"]
        if targeted:
            lines += ["", "**En lien avec l'offre :** " + ", ".join(targeted)]
        if others:
            lines += ["", "**Autres :** " + ", ".join(others)]

    if profile.experiences:
        lines += ["", "## Expériences"]
        for exp in profile.experiences:
            lines += _experience_block(exp)

    if profile.projects:
        lines += ["", "## Projets"]
        for project in profile.projects:
            lines += _experience_block(project)

    if profile.education:
        lines += ["", "## Formation"]
        for edu in profile.education:
            label = " — ".join(bit for bit in (edu.degree, edu.school) if bit)
            period = f" ({edu.period})" if edu.period else ""
            if label:
                lines.append(f"- {label}{period}")

    if profile.certifications:
        lines += ["", "## Certifications"]
        for cert in profile.certifications:
            label = " — ".join(bit for bit in (cert.name, cert.issuer) if bit)
            date = f" ({cert.date})" if cert.date else ""
            if label:
                lines.append(f"- {label}{date}")

    if profile.languages:
        lines += ["", "## Langues", ""]
        lines.append(
            ", ".join(
                " : ".join(bit for bit in (lang.name, lang.level) if bit)
                for lang in profile.languages
                if lang.name
            )
        )

    # Hors-ligne, on ne réécrit pas : on rattache le CV déposé tel quel, sauf si
    # les expériences structurées le rendent redondant.
    if profile.masterCv and not profile.experiences:
        lines += ["", "## Parcours", "", profile.masterCv]
    elif not (profile.summary or profile.all_skills or profile.experiences or profile.masterCv):
        lines += [
            "",
            "> Le profil est vide : dépose ton CV dans l'onglet Profil pour "
            "obtenir une vraie réécriture par offre.",
        ]

    return "\n".join(lines).strip() + "\n"


def render_master_cv(profile: ProfileIn) -> str:
    """CV « source » assemblé depuis le formulaire, sans référence à une offre.

    C'est le document que la personne relit dans l'onglet Profil et que le
    moteur réécrit ensuite pour chaque offre.
    """
    name = profile.fullName or "Mon CV"
    lines: list[str] = [f"# {name}"]

    subtitle = " · ".join(bit for bit in (profile.headline, profile.location) if bit)
    if subtitle:
        lines.append(f"_{subtitle}_")

    contact = _contact_line(profile)
    if contact:
        lines.append(contact)

    if profile.summary:
        lines += ["", "## En bref", "", profile.summary]

    # Les familles de compétences sont conservées : elles portent du sens que
    # la liste à plat perd (« Cloud & DevOps : AWS, GCP » ≠ « AWS, GCP »).
    if profile.skillGroups or profile.skills:
        lines += ["", "## Compétences", ""]
        for group in profile.skillGroups:
            if group.items:
                label = f"**{group.label}** : " if group.label else ""
                lines.append(f"- {label}{', '.join(group.items)}")
        if profile.skills:
            lines.append(f"- {', '.join(profile.skills)}")

    if profile.experiences:
        lines += ["", "## Expériences"]
        for exp in profile.experiences:
            lines += _experience_block(exp)

    if profile.projects:
        lines += ["", "## Projets"]
        for project in profile.projects:
            lines += _experience_block(project)

    if profile.education:
        lines += ["", "## Formation", ""]
        for edu in profile.education:
            label = " — ".join(bit for bit in (edu.degree, edu.school) if bit)
            period = f" ({edu.period})" if edu.period else ""
            if label:
                lines.append(f"- {label}{period}")

    if profile.certifications:
        lines += ["", "## Certifications", ""]
        for cert in profile.certifications:
            label = " — ".join(bit for bit in (cert.name, cert.issuer) if bit)
            date = f" ({cert.date})" if cert.date else ""
            if label:
                lines.append(f"- {label}{date}")

    if profile.languages:
        lines += ["", "## Langues", ""]
        for lang in profile.languages:
            if lang.name:
                lines.append(f"- {lang.name}" + (f" : {lang.level}" if lang.level else ""))

    if profile.interests:
        lines += ["", "## Centres d'intérêt", "", ", ".join(profile.interests)]

    if profile.links:
        lines += ["", "## Liens", ""]
        for link in profile.links:
            if link.url:
                lines.append(f"- {link.label or link.type} : {link.url}")

    return "\n".join(lines).strip() + "\n"


def render_cover_letter(
    offer: OfferIn,
    profile: ProfileIn,
    keywords: list[Keyword],
) -> str:
    name = profile.fullName or "Candidat"
    role = clean_title(offer.title) or "le poste"
    at_company = f" chez {offer.company}" if offer.company else ""

    paragraphs: list[str] = []

    opening = f"Le poste {de(role)}{at_company} retient mon attention"
    if offer.location:
        opening += f", à {offer.location}"
    opening += "."
    if profile.headline:
        opening += f" Je suis {profile.headline}."
    paragraphs.append(opening)

    targeted, _ = split_skills(profile, keywords)
    if targeted:
        paragraphs.append(
            "Sur les compétences attendues, je peux mettre en avant : "
            + ", ".join(targeted[:6])
            + "."
        )

    if profile.experiences:
        last = profile.experiences[0]
        bits = [bit for bit in (last.role, last.company) if bit]
        if bits:
            period = f" ({last.period})" if last.period else ""
            paragraphs.append(
                "Mon expérience la plus récente : " + " chez ".join(bits) + period + "."
            )

    paragraphs.append("Je reste disponible pour en échanger.")

    signature = [name]
    contact = _contact_line(profile)
    if contact:
        signature.append(contact)

    return "\n\n".join(
        [
            f"Objet : Candidature — {role}{at_company}",
            "Madame, Monsieur,",
            *paragraphs,
            "Cordialement,",
            "\n".join(signature),
        ]
    )
