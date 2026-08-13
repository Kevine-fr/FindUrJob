"""Diagnostic Adzuna : ce que le conteneur voit, et ce qu'Adzuna répond."""
import asyncio, httpx
from app.config import get_settings

s = get_settings()
aid, akey = s.adzuna_app_id.strip(), s.adzuna_app_key.strip()

def masque(v):
    return f"{v[:4]}…{v[-4:]} ({len(v)} car.)" if v else "VIDE"

print("app_id  :", masque(aid))
print("app_key :", masque(akey))
print("pays    :", s.adzuna_country)

async def main():
    if not aid or not akey:
        print("\n→ Le conteneur ne voit pas les clés. Voir la note ci-dessous.")
        return
    url = f"https://api.adzuna.com/v1/api/jobs/{s.adzuna_country}/search/1"
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(url, params={"app_id": aid, "app_key": akey, "results_per_page": 5,
                                     "what": "developpeur"}, headers={"Accept": "application/json"})
        print("\nHTTP", r.status_code)
        if r.status_code == 200:
            print("→ OK :", len(r.json().get("results", [])), "offre(s)")
        else:
            print("→ réponse :", r.text[:300])

asyncio.run(main())
