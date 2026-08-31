"""Rubriques d'un CV, reconnues sans modèle.

Le repli du repli. `parse_cv` demande d'abord au modèle, qui range mieux qu'une
heuristique — mais il n'est pas toujours joignable : clé absente, crédit épuisé,
quota atteint, panne. Jusqu'ici, l'import ne rendait alors *rien* du tout
(`fields = None`), et l'écran annonçait « moteur IA indisponible » sans que
personne ne sache s'il fallait attendre, payer, ou recommencer.

Ce module lit ce qu'un CV français écrit noir sur blanc : des titres de
rubriques, des dates, des puces. Il ne devine pas et ne reformule pas. Ce qu'il
rend est moins fin que le modèle — il faut le relire — mais il rend quelque
chose, toujours, et hors ligne.
"""

from __future__ import annotations

import re
import unicodedata

# --- Titres de rubriques -------------------------------------------------
#
# Un titre de CV est court, tient sur sa ligne et n'a pas de ponctuation
# finale. On accepte les variantes usuelles, accentuées ou non, au singulier
# comme au pluriel.
SECTIONS: dict[str, str] = {
    "experience": r"exp[ée]riences?(\s+(professionnelles?|pro))?|parcours(\s+professionnel)?|emplois?",
    "education": r"formations?|[ée]ducation|dipl[ôo]mes?|cursus|scolarit[ée]",
    "skills": r"comp[ée]tences?|savoir[- ]faire|technologies?|stack(\s+technique)?|technique",
    "languages": r"langues?",
    "projects": r"projets?|r[ée]alisations?",
    "interests": r"centres?\s+d[e'’]\s*int[ée]r[êe]ts?|loisirs?|hobbies",
    "summary": r"profil|[àa]\s+propos|r[ée]sum[ée]|pr[ée]sentation|accroche|objectif",
}

_MOIS = (
    "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|"
    "novembre|d[ée]cembre|jan|f[ée]v|avr|juil|sept|oct|nov|d[ée]c"
)

# Une date : « 2022 », « Mars 2022 », « 03/2022 ».
#
# Le mois en toutes lettres doit pouvoir précéder l'année **sans** chiffres
# devant. Un premier motif exigeait `\d{1,2}` avant l'année : « Septembre 2019 –
# Février 2022 » échouait donc entièrement, quand « Mars 2022 – Aujourd'hui »
# passait — sa fin étant un mot, pas une date. Une expérience sur trois
# seulement était reconnue, et les deux autres se retrouvaient en puces.
_DATE = rf"(?:\d{{1,2}}[/.])?(?:(?:{_MOIS})\.?\s*)?\d{{4}}"

# Une période : « Mars 2022 – Aujourd'hui », « 2016 - 2018 », « 09/2019 — 02/2022 ».
_PERIODE = re.compile(
    rf"(?P<debut>{_DATE})"
    rf"\s*(?:–|—|-|à|au|jusqu'|\bto\b)\s*"
    rf"(?P<fin>aujourd[' ]?hui|actuel(?:lement)?|pr[ée]sent|en cours|{_DATE})",
    re.I,
)

_MOIS_NUM = {
    "jan": "01", "f[ée]v": "02", "mar": "03", "avr": "04", "mai": "05", "juin": "06",
    "juil": "07", "ao": "08", "sep": "09", "oct": "10", "nov": "11", "d[ée]c": "12",
}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# Numéros français et internationaux, avec séparateurs variés.
TEL = re.compile(r"(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?0\)?[\s.-]?)?\d(?:[\s.-]?\d){8,12}")
PUCE = re.compile(r"^\s*[-•·▪◦*–—]\s+")


def _sans_accents(texte: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn"
    )


def _titre_de_section(ligne: str) -> str | None:
    """La ligne est-elle un titre de rubrique ? Rend la clé, ou None."""
    nu = ligne.strip().rstrip(":").strip()
    # Un titre est court et sans phrase : au-delà, c'est du contenu.
    if not nu or len(nu) > 42 or nu.count(" ") > 4:
        return None
    plat = _sans_accents(nu).lower()
    for cle, motif in SECTIONS.items():
        if re.fullmatch(_sans_accents(motif), plat, re.I):
            return cle
    return None


def _iso(fragment: str) -> str:
    """« Mars 2022 » → « 2022-03-01 ». Sans mois lisible, on rend l'année seule."""
    if not fragment:
        return ""
    frag = fragment.strip()
    if re.fullmatch(r"aujourd[' ]?hui|actuel(?:lement)?|pr[ée]sent|en cours", frag, re.I):
        return ""
    annee = re.search(r"(19|20)\d{2}", frag)
    if not annee:
        return ""
    plat = _sans_accents(frag).lower()
    for prefixe, numero in _MOIS_NUM.items():
        if re.search(_sans_accents(prefixe), plat):
            return f"{annee.group(0)}-{numero}-01"
    mois_num = re.search(r"\b(0?[1-9]|1[0-2])[/.](?:19|20)\d{2}", frag)
    if mois_num:
        return f"{annee.group(0)}-{int(mois_num.group(1)):02d}-01"
    return annee.group(0)


def _decouper(lignes: list[str]) -> dict[str, list[str]]:
    """Range les lignes sous leur rubrique. Ce qui précède la première va en `entete`."""
    blocs: dict[str, list[str]] = {"entete": []}
    courante = "entete"
    for ligne in lignes:
        cle = _titre_de_section(ligne)
        if cle:
            courante = cle
            blocs.setdefault(cle, [])
            continue
        blocs.setdefault(courante, []).append(ligne)
    return blocs


def _rejoindre(lignes: list[str], *, listes: bool = False) -> list[str]:
    """Recolle les lignes que la mise en page a coupées.

    Un PDF ne rend pas des paragraphes, il rend des lignes : « ...2,3 M
    d'utilisateurs » et « mensuels » arrivent séparés, et chaque morceau était
    compté comme une entrée distincte — d'où six expériences là où le CV en
    montre trois.

    Deux signaux, tirés du texte réel et non supposés : une ligne qui se termine
    par une virgule appelle la suivante, et une ligne qui commence par une
    minuscule continue la précédente. Dans une liste de compétences, deux lignes
    à virgules qui se suivent sont le même énoncé coupé (« Docker, Kubernetes,
    GitHub » / « Actions, Terraform »).
    """
    sortie: list[str] = []
    for brute in lignes:
        nue = brute.strip()
        if not nue:
            continue
        if sortie:
            precedente = sortie[-1]
            suite = (
                precedente.endswith(",")
                or (nue[:1].islower() and not precedente.endswith((".", ":", ";")))
                or (listes and "," in precedente and "," in nue)
            )
            if suite:
                sortie[-1] = f"{precedente.rstrip(',')}, {nue}" if precedente.endswith(",") else f"{precedente} {nue}"
                continue
        sortie.append(nue)
    return sortie


def _entrees(lignes: list[str]) -> list[dict]:
    """Coupe une rubrique en entrées.

    Un CV imprimé écrit ses entrées de la même façon : un titre, puis les dates,
    puis ce qu'on y a fait. C'est **la ligne suivante** qui révèle le titre — si
    elle porte une période, ce qui la précède nomme le poste ou le diplôme.

    Se fier aux puces ne marchait pas : l'extraction PDF les supprime, si bien
    que chaque tâche ressemblait à un nouveau poste.
    """
    propres = _rejoindre(lignes)
    if not propres:
        return []

    porte_periode = [bool(_PERIODE.search(l)) for l in propres]

    # Sans aucune date dans la rubrique — des projets, souvent — on se rabat sur
    # la longueur : un titre est court, ce qu'on en dit ne l'est pas.
    aucune_date = not any(porte_periode)

    entrees: list[dict] = []
    courante: dict | None = None

    for i, ligne in enumerate(propres):
        suivante_datee = i + 1 < len(propres) and porte_periode[i + 1]
        est_titre = (
            (suivante_datee and not porte_periode[i])
            if not aucune_date
            else (len(ligne) < 50 and not ligne.endswith("."))
        )

        if est_titre:
            courante = {"titre": ligne, "lieu": "", "debut": "", "fin": "", "bullets": []}
            entrees.append(courante)
            continue

        if porte_periode[i] and courante is not None and not courante["debut"]:
            periode = _PERIODE.search(ligne)
            courante["debut"] = _iso(periode.group("debut"))
            courante["fin"] = _iso(periode.group("fin"))
            reste = _PERIODE.sub("", ligne).strip(" ·|,-–—\t")
            if reste:
                courante["lieu"] = reste
            continue

        if courante is not None:
            courante["bullets"].append(PUCE.sub("", ligne).strip())

    return [e for e in entrees if e["titre"]]


def _couper_titre(titre: str) -> tuple[str, str]:
    """« Lead Développeur — Doctolib » → (« Lead Développeur », « Doctolib »)."""
    for separateur in ("—", "–", " - ", " | ", " @ ", " chez ", ", "):
        if separateur in titre:
            gauche, droite = titre.split(separateur, 1)
            return gauche.strip(), droite.strip()
    return titre.strip(), ""


def _competences(lignes: list[str]) -> list[dict]:
    """« Langages : Python, Go » ou un libellé seul suivi de sa liste."""
    groupes: list[dict] = []
    en_attente: str | None = None

    for ligne in _rejoindre(lignes, listes=True):
        nue = PUCE.sub("", ligne).strip()
        if not nue:
            continue

        if ":" in nue:
            libelle, valeurs = nue.split(":", 1)
            items = [v.strip() for v in re.split(r"[,;·•/]", valeurs) if v.strip()]
            if items:
                groupes.append({"label": libelle.strip() or "Compétences", "items": items})
                en_attente = None
                continue

        # Un libellé court sans valeurs annonce la ligne suivante.
        if en_attente is None and len(nue) <= 32 and "," not in nue:
            en_attente = nue
            continue

        items = [v.strip() for v in re.split(r"[,;·•/]", nue) if v.strip()]
        if items:
            groupes.append({"label": en_attente or "Compétences", "items": items})
        en_attente = None

    # Sans le moindre regroupement, tout tient dans un groupe unique.
    if not groupes:
        tout = [
            v.strip()
            for ligne in lignes
            for v in re.split(r"[,;·•/]", PUCE.sub("", ligne))
            if v.strip()
        ]
        if tout:
            groupes.append({"label": "Compétences", "items": tout})
    return groupes


def _langues(lignes: list[str]) -> list[dict]:
    langues: list[dict] = []
    for ligne in _rejoindre(lignes):
        nue = PUCE.sub("", ligne).strip()
        if not nue:
            continue
        coupe = re.split(r"\s*[—–\-:()]\s*", nue, maxsplit=1)
        nom = coupe[0].strip()
        niveau = coupe[1].strip(" )") if len(coupe) > 1 else ""
        if nom and len(nom) <= 30:
            langues.append({"name": nom, "level": niveau})
    return langues


def parse_cv_sections(texte: str) -> dict:
    """Rubriques d'un CV, sans appel au modèle.

    Rend toujours un dictionnaire conforme au schéma attendu : c'est une
    proposition à relire, jamais une vérité. Les champs qu'on ne sait pas lire
    restent vides — on ne comble pas un trou par une valeur plausible.
    """
    lignes = [l.rstrip() for l in (texte or "").splitlines()]
    blocs = _decouper(lignes)
    entete = blocs.get("entete", [])
    entete_texte = "\n".join(entete)

    email = EMAIL.search(entete_texte) or EMAIL.search(texte or "")
    # Le motif du téléphone attrape aussi des suites de chiffres quelconques :
    # on exige au moins huit chiffres réels dans la correspondance.
    telephone = ""
    for essai in TEL.finditer(entete_texte):
        if len(re.sub(r"\D", "", essai.group(0))) >= 9:
            telephone = essai.group(0).strip()
            break

    pleines = [l.strip() for l in entete if l.strip()]
    nom = pleines[0] if pleines else ""
    # La ligne du nom porte parfois déjà le contact : on ne garde que le début.
    if nom:
        nom = re.split(r"[·|]|\s{2,}", nom)[0].strip()

    accroche = " ".join(l.strip() for l in blocs.get("summary", []) if l.strip()).strip()

    intitule = ""
    lieu = ""
    for ligne in pleines[1:4]:
        morceaux = [m.strip() for m in re.split(r"[·|]", ligne) if m.strip()]
        for m in morceaux:
            if EMAIL.search(m) or re.search(r"\d{2}[\s.-]?\d{2}", m):
                continue
            if not intitule:
                intitule = m
            elif not lieu and len(m) <= 40:
                lieu = m

    experiences = []
    for e in _entrees(blocs.get("experience", [])):
        role, societe = _couper_titre(e["titre"])
        experiences.append(
            {
                "role": role,
                "company": societe,
                "location": e["lieu"],
                "startDate": e["debut"],
                "endDate": e["fin"],
                "bullets": e["bullets"],
            }
        )

    education = []
    for e in _entrees(blocs.get("education", [])):
        diplome, ecole = _couper_titre(e["titre"])
        education.append(
            {
                "degree": diplome,
                "school": ecole,
                "location": e["lieu"],
                "startDate": e["debut"],
                "endDate": e["fin"],
                "details": " ".join(e["bullets"]),
            }
        )

    projets = [
        {"name": e["titre"], "startDate": e["debut"], "endDate": e["fin"], "bullets": e["bullets"]}
        for e in _entrees(blocs.get("projects", []))
    ]

    interets = [
        v.strip()
        for ligne in blocs.get("interests", [])
        for v in re.split(r"[,;·•]", PUCE.sub("", ligne))
        if v.strip()
    ]

    return {
        "fullName": nom,
        "headline": intitule,
        "email": email.group(0) if email else "",
        "phone": telephone,
        "location": lieu,
        "summary": accroche,
        "skillGroups": _competences(blocs.get("skills", [])),
        "experiences": experiences,
        "education": education,
        "projects": projets,
        "languages": _langues(blocs.get("languages", [])),
        "interests": interets,
    }
