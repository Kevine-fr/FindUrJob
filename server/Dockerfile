FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4000
CMD ["node", "src/index.js"]

# Version et revision, injectees par la CI au moment de la publication.
#
# En fin d'etage, et non au debut : leur valeur change a chaque publication, et
# placee plus haut elle invaliderait tout le cache de construction en dessous.
# Des etiquettes plutot que des variables d'environnement : `docker inspect` les
# expose sans risquer d'ecraser la valeur passee au conteneur.
ARG APP_VERSION=""
ARG APP_COMMIT=""
LABEL org.opencontainers.image.title="FindUrJob server" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$APP_COMMIT" \
      org.opencontainers.image.source="https://github.com/Kevine-fr/FindUrJob"
