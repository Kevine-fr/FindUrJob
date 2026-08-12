# Playwright installe lui-même le Chromium correspondant à sa version : on part
# d'une image Node nue plutôt que d'une image Playwright figée, pour que la
# paire (bibliothèque, navigateur) reste cohérente à chaque `npm install`.
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    BOT_PROFILE_DIR=/data/profiles

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# `--with-deps` tire les bibliothèques système de Chromium.
# Inter n'est pas indispensable, mais sans elle le PDF n'a pas la même police
# que l'aperçu — et donc pas les mêmes hauteurs de ligne.
#
# Xvfb/x11vnc/noVNC servent la reprise en main : les navigateurs des plateformes
# tournent en mode visible sur un écran virtuel, que l'utilisateur peut prendre
# à la souris quand une connexion automatique bute sur une vérification.
RUN npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb x11vnc x11-utils novnc websockify \
    && (apt-get install -y --no-install-recommends fonts-inter || true) \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN mkdir -p /data/profiles && chmod +x docker-entrypoint.sh

ENV DISPLAY=:99 \
    VNC_PORT=6080

EXPOSE 8100 6080
CMD ["./docker-entrypoint.sh"]
