import pytest

from app.guards import inspect, is_usable
from app.keywords import extract_keywords
from app.rendering import clean_title, de, render_cover_letter, render_cv, split_skills
from app.schemas import OfferIn, ProfileIn


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Développeur Full Stack (H/F)", "Développeur Full Stack"),
        ("Data Analyst H/F", "Data Analyst"),
        ("Chef de projet (F/H)", "Chef de projet"),
        ("Ingénieur DevOps (h/f/x)", "Ingénieur DevOps"),
        ("Product Owner", "Product Owner"),
    ],
)
def test_mentions_administratives_retirees(raw, expected):
    assert clean_title(raw) == expected


@pytest.mark.parametrize(
    "role,expected",
    [
        ("Ingénieur DevOps", "d'Ingénieur DevOps"),
        ("Développeur", "de Développeur"),
        ("Architecte", "d'Architecte"),
        ("Chef de projet", "de Chef de projet"),
    ],
)
def test_elision_devant_voyelle(role, expected):
    assert de(role) == expected


def test_cv_priorise_les_competences_de_loffre(sample_offer, sample_profile):
    keywords = extract_keywords(sample_offer)
    targeted, others = split_skills(sample_profile, keywords)

    assert "Node.js" in targeted
    assert "React" in targeted
    assert "Figma" in others  # sans rapport avec l'offre


def test_cv_contient_les_sections_attendues(sample_offer, sample_profile):
    cv = render_cv(sample_offer, sample_profile, extract_keywords(sample_offer), offline=True)

    assert cv.startswith("# Camille Dupont")
    assert "## Compétences" in cv
    assert "## Expériences" in cv
    assert "## Formation" in cv
    assert "Studio Katana" in cv
    assert "hors-ligne" in cv  # le brouillon déterministe s'annonce comme tel


def test_lettre_reste_factuelle(sample_offer, sample_profile):
    letter = render_cover_letter(sample_offer, sample_profile, extract_keywords(sample_offer))

    assert letter.startswith("Objet : Candidature")
    assert "Atelier Numérique" in letter
    assert "Camille Dupont" in letter
    assert len(letter.split()) < 200


def test_profil_vide_reste_exploitable():
    cv = render_cv(OfferIn(title="Développeur"), ProfileIn(), [], offline=True)

    assert "Candidat" in cv
    assert "onglet Profil" in cv  # on dit quoi faire plutôt que d'inventer


def test_cv_maitre_utilise_si_pas_de_profil_structure():
    profile = ProfileIn(fullName="Sam", masterCv="15 ans de support informatique.")
    cv = render_cv(OfferIn(title="Technicien"), profile, [], offline=True)

    assert "15 ans de support informatique." in cv


def test_placeholders_signales():
    warnings = inspect("# Titre\n[À compléter]", "Madame, Monsieur, {{nom}}", ProfileIn())

    assert any("compléter" in warning for warning in warnings)
    assert len(warnings) >= 2  # un par document


def test_nom_absent_signale():
    profile = ProfileIn(fullName="Camille Dupont", skills=["Node.js"])
    warnings = inspect("# Quelqu'un d'autre\n\nUn CV sans le bon nom.", "Lettre.", profile)

    assert any("nom du candidat" in warning for warning in warnings)


def test_lettre_trop_longue_signalee():
    profile = ProfileIn(fullName="Camille", skills=["Node.js"])
    warnings = inspect("# Camille", "mot " * 500, profile)

    assert any("Lettre longue" in warning for warning in warnings)


def test_sortie_trop_courte_inutilisable():
    assert not is_usable("trop court", "aussi")
    assert is_usable("x" * 400, "y" * 200)
