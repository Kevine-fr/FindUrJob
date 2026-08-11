"""Le contrat avec l'API Node : { offer, profile } -> { content, coverLetter, score, keywords }."""


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["provider"] == "offline"
    assert body["llm"] is False


def test_tailor_respecte_le_contrat(client, sample_payload):
    response = client.post("/tailor", json=sample_payload)
    assert response.status_code == 200

    body = response.json()
    assert {"content", "coverLetter", "score", "keywords"} <= set(body)

    assert isinstance(body["content"], str) and body["content"].strip()
    assert isinstance(body["coverLetter"], str) and body["coverLetter"].strip()
    assert isinstance(body["score"], int) and 0 <= body["score"] <= 100
    assert isinstance(body["keywords"], list)
    assert all(isinstance(keyword, str) for keyword in body["keywords"])


def test_tailor_utilise_le_profil_et_loffre(client, sample_payload):
    body = client.post("/tailor", json=sample_payload).json()

    assert "Camille Dupont" in body["content"]
    assert "Node.js" in body["content"]
    assert "Atelier Numérique" in body["coverLetter"]
    assert body["score"] >= 50  # profil aligné sur l'offre


def test_meta_est_informative(client, sample_payload):
    meta = client.post("/tailor", json=sample_payload).json()["meta"]

    assert meta["provider"] == "offline"
    assert meta["generatedAt"]
    assert meta["scoreBreakdown"]["skills"] > 0
    assert "Node.js" in meta["scoreBreakdown"]["matchedKeywords"]


def test_entree_vide_ne_casse_pas(client):
    response = client.post("/tailor", json={})
    assert response.status_code == 200

    body = response.json()
    assert body["score"] == 0
    assert body["content"].strip()
    assert body["coverLetter"].strip()
    assert body["meta"]["warnings"]  # on prévient que le profil est vide


def test_champs_nuls_ne_cassent_pas(client):
    response = client.post(
        "/tailor",
        json={
            "offer": {"title": "Développeur Python", "description": None, "keywords": None},
            "profile": {"fullName": None, "skills": None, "experiences": None, "links": None},
        },
    )
    assert response.status_code == 200
    assert response.json()["content"].strip()


def test_description_geante_est_tronquee(client, sample_payload):
    sample_payload["offer"]["description"] = "Docker Kubernetes " * 20000
    response = client.post("/tailor", json=sample_payload)

    assert response.status_code == 200
    assert 0 <= response.json()["score"] <= 100


def test_resultat_reproductible(client, sample_payload):
    first = client.post("/tailor", json=sample_payload).json()
    second = client.post("/tailor", json=sample_payload).json()

    assert first["score"] == second["score"]
    assert first["keywords"] == second["keywords"]
    assert first["content"] == second["content"]
