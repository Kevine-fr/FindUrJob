# Deux usages, deux étages.
#
#   dev     : serveur Vite, rechargement à chaud (docker-compose.yml)
#   runtime : fichiers compilés servis par nginx (docker-compose.prod.yml)
#
# Le serveur de développement n'a rien à faire en production : il recompile à
# chaque requête, expose les sources, et refuse les noms d'hôte qu'il ne connaît
# pas — c'est cette dernière protection qui rejette le domaine du VPS.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# --- Développement -----------------------------------------------------
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# --- Compilation -------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# --- Production --------------------------------------------------------
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5173
