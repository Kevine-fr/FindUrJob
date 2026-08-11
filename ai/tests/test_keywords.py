from app.keywords import extract_keywords
from app.schemas import OfferIn


def _norms(keywords) -> list[str]:
    return [kw.norm for kw in keywords]


def test_extraction_sur_une_offre_reelle(sample_offer):
    keywords = extract_keywords(sample_offer)
    norms = _norms(keywords)

    for expected in ("node.js", "react", "mongodb", "docker", "linux"):
        assert expected in norms

    # Les poids sont normalisés et triés par ordre décroissant.
    assert keywords[0].weight == 1.0
    assert all(0 < kw.weight <= 1 for kw in keywords)
    assert _norms(keywords) == _norms(sorted(keywords, key=lambda kw: -kw.weight))


def test_le_titre_pese_plus_que_le_corps(sample_offer):
    keywords = {kw.norm: kw.weight for kw in extract_keywords(sample_offer)}

    # « react » est dans l'intitulé, « kubernetes » seulement dans le corps.
    assert keywords["react"] > keywords["kubernetes"]


def test_stopwords_et_mentions_hf_ecartes(sample_offer):
    norms = _norms(extract_keywords(sample_offer))

    for noise in ("h/f", "nous", "une", "les", "poste"):
        assert noise not in norms


def test_expressions_du_lexique_reconnues():
    offer = OfferIn(
        title="Data engineer",
        description="Vous travaillerez sur la base de données et l'intégration continue.",
    )
    norms = _norms(extract_keywords(offer))

    assert "base de donnees" in norms
    assert "integration continue" in norms


def test_mots_cles_saisis_a_la_main_sont_prioritaires():
    offer = OfferIn(
        title="Développeur",
        description="Un poste polyvalent au sein d'une petite équipe.",
        keywords=["Rust"],
    )
    keywords = extract_keywords(offer)

    assert keywords[0].norm == "rust"


def test_remplissage_dannonce_ecarte(sample_offer):
    """Les mots vus une seule fois, hors lexique et hors intitulé, sont du bruit."""
    norms = _norms(extract_keywords(sample_offer))

    for filler in ("participerez", "renforcons", "quotidien", "equivalent", "minimum"):
        assert filler not in norms

    for signal in ("node.js", "react", "kubernetes", "gitlab"):
        assert signal in norms


def test_offre_pauvre_conserve_ses_termes():
    """Le seuil est relatif : sur une offre sans signal fort, on ne vide pas tout."""
    offer = OfferIn(description="Vous accompagnerez nos adhérents dans leurs démarches.")

    assert extract_keywords(offer)


def test_offre_vide():
    assert extract_keywords(OfferIn()) == []


def test_casse_dorigine_conservee():
    offer = OfferIn(title="Développeur PostgreSQL", description="PostgreSQL et Docker.")
    terms = [kw.term for kw in extract_keywords(offer)]

    assert "PostgreSQL" in terms
    assert "Docker" in terms
