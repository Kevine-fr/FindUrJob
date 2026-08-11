# syntax=docker/dockerfile:1

# --- Image d'exécution -------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --system --uid 10001 --create-home findurjob \
    && chown -R findurjob:findurjob /app
USER findurjob

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# --- Image de développement (tests + rechargement à chaud) --------------
# docker-compose utilise cet étage ; en production, viser `runtime`.
FROM runtime AS dev

USER root
COPY requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY pytest.ini ./
COPY tests ./tests
RUN chown -R findurjob:findurjob /app
USER findurjob

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
