from datetime import date

from app.keywords import extract_keywords
from app.schemas import EducationIn, ExperienceIn, OfferIn, ProfileIn
from app.scoring import compute_score, experience_years, required_years

TODAY = date(2026, 1, 15)  # figé : le score doit être reproductible


def _score(offer: OfferIn, profile: ProfileIn) -> int:
    return compute_score(offer, profile, extract_keywords(offer), today=TODAY).score


def test_profil_aligne_score_haut(sample_offer, sample_profile):
    assert _score(sample_offer, sample_profile) >= 50


def test_profil_hors_sujet_score_bas(sample_offer):
    profile = ProfileIn(
        fullName="Alex Martin",
        headline="Chef pâtissier",
        location="Marseille",
        skills=["Pâtisserie", "Chocolat", "Gestion des stocks"],
        experiences=[
            ExperienceIn(role="Chef pâtissier", company="Maison Léon", period="2018 - 2024")
        ],
        education=[EducationIn(degree="CAP Pâtisserie", school="CFA", period="2016 - 2018")],
    )
    aligned_offer = sample_offer

    assert _score(aligned_offer, profile) < 30


def test_intitule_au_feminin_reconnu():
    """« Développeuse » doit répondre à « Développeur » : c'est le même poste."""
    offer = OfferIn(title="Développeur Full Stack")
    profile = ProfileIn(headline="Développeuse Full Stack")

    breakdown = compute_score(offer, profile, extract_keywords(offer), today=TODAY).breakdown

    assert breakdown.title == 20


def test_identifiants_techniques_non_deformes():
    """Le « s » de Node.js ou d'AWS n'est pas une marque de pluriel."""
    offer = OfferIn(title="Développeur Node.js", description="Node.js, AWS et tests unitaires.")
    profile = ProfileIn(skills=["Node.js", "AWS"], headline="Développeur")

    matched = compute_score(
        offer, profile, extract_keywords(offer), today=TODAY
    ).breakdown.matchedKeywords

    assert "Node.js" in matched
    assert "AWS" in matched


def test_variantes_decriture_rapprochees():
    """« CI-CD » dans l'annonce et « CI/CD » dans le CV désignent la même chose."""
    offer = OfferIn(
        title="Ingénieur DevOps (CI-CD)",
        description="Pipelines CI-CD, Kubernetes et PostgreSQL.",
    )
    profile = ProfileIn(headline="Ingénieur DevOps", skills=["CI/CD", "K8s", "Postgres"])

    missing = compute_score(
        offer, profile, extract_keywords(offer), today=TODAY
    ).breakdown.missingKeywords

    for variant in ("CI-CD", "Kubernetes", "PostgreSQL"):
        assert variant not in missing


def test_tout_vide_donne_zero():
    assert _score(OfferIn(), ProfileIn()) == 0


def test_score_borne(sample_offer, sample_profile):
    result = compute_score(sample_offer, sample_profile, extract_keywords(sample_offer), today=TODAY)

    assert 0 <= result.score <= 100
    assert result.breakdown.skills <= 60
    assert result.breakdown.title <= 20
    assert result.breakdown.seniority <= 10
    assert result.breakdown.location <= 10


def test_detail_du_score(sample_offer, sample_profile):
    breakdown = compute_score(
        sample_offer, sample_profile, extract_keywords(sample_offer), today=TODAY
    ).breakdown

    assert "Kubernetes" in breakdown.missingKeywords  # absent du profil
    assert breakdown.location == 10  # même ville
    assert breakdown.seniority == 10  # 3 ans demandés, profil plus expérimenté


def test_annees_experience_fusionne_les_chevauchements():
    profile = ProfileIn(
        experiences=[
            ExperienceIn(period="2019 - 2022"),
            ExperienceIn(period="2021 - 2024"),  # chevauche la précédente
        ]
    )

    assert experience_years(profile, today=TODAY) == 5


def test_annees_experience_poste_en_cours():
    profile = ProfileIn(experiences=[ExperienceIn(period="2023 - aujourd'hui")])

    assert experience_years(profile, today=TODAY) == 3


def test_annees_demandees():
    assert required_years(OfferIn(description="3 ans d'expérience minimum")) == 3
    assert required_years(OfferIn(description="5+ années sur un poste similaire")) == 5
    assert required_years(OfferIn(description="Aucune expérience requise")) == 0
    # 45 000 € ne doit pas être lu comme 45 ans
    assert required_years(OfferIn(description="Salaire 45000 € sur 12 mois")) == 0


def test_teletravail_neutralise_la_distance(sample_profile):
    offer = OfferIn(
        title="Développeur Node.js",
        description="Node.js, React et Docker.",
        location="Bordeaux",
        remote="teletravail",
    )
    breakdown = compute_score(offer, sample_profile, extract_keywords(offer), today=TODAY).breakdown

    assert breakdown.location == 10


def test_ville_differente_penalise(sample_profile):
    offer = OfferIn(
        title="Développeur Node.js",
        description="Node.js, React et Docker.",
        location="Bordeaux",
        remote="sur_site",
    )
    breakdown = compute_score(offer, sample_profile, extract_keywords(offer), today=TODAY).breakdown

    assert breakdown.location == 3
