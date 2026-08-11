"""Prompts de reciblage.

`SYSTEM_PROMPT` est une constante : elle ne varie ni par offre ni par profil,
ce qui permet de la mettre en cache côté API (voir providers/anthropic.py).
"""

import json

from .keywords import Keyword
from .schemas import OfferIn, ProfileIn
from .textutils import truncate

SYSTEM_PROMPT = """\
Tu es le moteur de reciblage de FindUrJob. Ton travail : RÉÉCRIRE le CV d'une
personne pour une offre précise, et rédiger la lettre qui va avec.
Tu écris exclusivement en français.

TU RÉÉCRIS, TU NE PROPOSES PAS.
Ta sortie est le document final, prêt à être envoyé tel quel. Tu ne produis
jamais une liste de suggestions, des recommandations, des commentaires sur ce
qu'il faudrait changer, ni un texte du type « voici quelques pistes ». Le champ
`content` contient un CV complet, du nom en en-tête jusqu'à la dernière ligne
de formation.

RÈGLE ABSOLUE — n'invente aucun fait.
Tu ne disposes que du CV et du profil fournis. Il t'est interdit d'ajouter une
entreprise, un diplôme, une technologie, une certification, une date, une durée
ou un chiffre qui n'y figure pas. Tu réorganises, tu hiérarchises, tu
reformules, tu choisis ce que tu mets en avant — tu n'ajoutes jamais.
Si l'offre demande une compétence absente du dossier, ne la revendique pas :
soit tu l'ignores, soit tu t'appuies sur la compétence proche réellement
présente. Une candidature honnête et courte vaut mieux qu'une candidature
gonflée : les recruteurs vérifient en entretien.

CE QUE TU PRODUIS
1. `content` — le CV réécrit, en Markdown :
   - `# Prénom Nom`, puis une ligne d'accroche retravaillée pour cette offre et
     les coordonnées présentes dans le dossier ;
   - `## En bref` : 2 à 3 phrases qui répondent à cette offre précise ;
   - `## Compétences` : celles du dossier, réordonnées, les plus attendues par
     l'offre en premier, avec le vocabulaire de l'offre quand il désigne bien la
     même chose ;
   - `## Expériences` : `### Rôle — Entreprise`, la période, puis 2 à 4 puces
     réécrites sous l'angle de l'offre — mêmes faits, angle différent ;
   - `## Formation`, et les autres rubriques du CV source (langues,
     certifications, projets…) si elles existent.
   TOUTES les expériences et formations du CV source doivent se retrouver dans
   ta réécriture. Tu changes l'ordre, la formulation et le relief ; tu ne
   supprimes pas un poste et tu n'en inventes pas.
2. `coverLetter` — la lettre, en texte brut : objet, « Madame, Monsieur, »,
   250 mots maximum, 3 paragraphes courts (pourquoi ce poste, ce que le dossier
   apporte concrètement, disponibilité), puis « Cordialement, » et le nom.
3. `keywords` — les termes de l'offre qui ont guidé ta réécriture.

STYLE
Sobre et direct. Pas de superlatifs, pas de « passionné par », pas de
storytelling. Des faits. Aucun crochet à compléter, aucun `[placeholder]`,
aucune mention de pièce jointe fictive : si une information manque, écris la
phrase sans elle.
"""


def _compact(payload: dict) -> dict:
    """Retire les valeurs vides pour ne pas polluer le prompt."""
    cleaned = {}
    for key, value in payload.items():
        if value in ("", None, [], {}):
            continue
        cleaned[key] = value
    return cleaned


def build_offer_payload(offer: OfferIn, *, max_description_chars: int) -> dict:
    return _compact(
        {
            "intitule": offer.title,
            "entreprise": offer.company,
            "lieu": offer.location,
            "contrat": offer.contractType,
            "teletravail": offer.remote,
            "salaire": offer.salary,
            "description": truncate(offer.description, max_description_chars),
        }
    )


def build_profile_payload(profile: ProfileIn) -> dict:
    """Champs structurés du profil. Le CV déposé est envoyé à part, en clair."""
    return _compact(
        {
            "nom": profile.fullName,
            "accroche": profile.headline,
            "email": profile.email,
            "telephone": profile.phone,
            "localisation": profile.location,
            "resume": profile.summary,
            "competences": profile.skills,
            "experiences": [
                _compact(
                    {
                        "poste": exp.role,
                        "entreprise": exp.company,
                        "periode": exp.period,
                        "description": exp.description,
                    }
                )
                for exp in profile.experiences
            ],
            "formation": [
                _compact({"diplome": edu.degree, "ecole": edu.school, "periode": edu.period})
                for edu in profile.education
            ],
            "liens": profile.links,
        }
    )


def build_user_prompt(
    offer: OfferIn,
    profile: ProfileIn,
    keywords: list[Keyword],
    *,
    max_description_chars: int,
    max_cv_chars: int = 24000,
) -> str:
    offer_json = json.dumps(
        build_offer_payload(offer, max_description_chars=max_description_chars),
        ensure_ascii=False,
        indent=2,
    )
    profile_json = json.dumps(build_profile_payload(profile), ensure_ascii=False, indent=2)
    keyword_line = ", ".join(kw.term for kw in keywords[:15]) or "(aucun mot-clé exploitable)"

    # Le CV déposé est le document à réécrire : il est présenté en clair, pas
    # noyé dans le JSON du profil.
    if profile.masterCv.strip():
        cv_section = f"""\
# CV actuel du candidat — DOCUMENT À RÉÉCRIRE

Voici le CV tel que la personne l'utilise aujourd'hui. C'est ce document que tu
dois réécrire pour l'offre ci-dessus : toutes ses expériences et formations
doivent se retrouver dans ta version, réorganisées et reformulées.

```
{truncate(profile.masterCv, max_cv_chars)}
```
"""
        task = """\
Réécris ce CV pour cette offre. Le champ `content` doit contenir le CV complet,
prêt à envoyer : mêmes faits, ordre et formulations retravaillés pour répondre
aux mots-clés ci-dessus. N'omets aucune expérience du CV source, n'invente
rien.
"""
    else:
        cv_section = """\
# CV actuel du candidat

Aucun CV n'a été déposé : appuie-toi uniquement sur les champs structurés
ci-dessus.
"""
        task = """\
Rédige le CV et la lettre à partir des seules informations structurées
ci-dessus. Si le dossier est trop pauvre pour répondre à l'offre, produis un
document honnête et court plutôt qu'un texte gonflé.
"""

    return f"""\
# Offre

{offer_json}

# Mots-clés prioritaires extraits de l'offre

{keyword_line}

# Fiche du candidat (seule source de vérité, avec le CV ci-dessous)

{profile_json}

{cv_section}

# Travail demandé

{task}"""
