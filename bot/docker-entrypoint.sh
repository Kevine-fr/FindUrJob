#!/bin/sh
# Écran virtuel + passerelle noVNC, puis le service.
#
# Les navigateurs des plateformes tournent en mode *visible* sur cet écran :
# c'est ce qui permet de reprendre la main quand une connexion automatique
# échoue (2FA, captcha) et de terminer soi-même — la session obtenue est alors
# la vraie, dans le même profil que celui qu'utilisera le robot ensuite.
set -e

: "${DISPLAY:=:99}"
: "${VNC_GEOMETRY:=1440x900x24}"
export DISPLAY

# Un `docker compose restart` ne vide pas /tmp : le verrou du serveur X et sa
# socket survivent au processus qui les a créés, et Xvfb refuse alors de
# démarrer (« Server is already active for display 99 »). Le conteneur reste
# « running » mais le service ne répond plus. Comme rien d'autre ne peut
# détenir cet écran dans ce conteneur, le verrou trouvé ici est forcément mort.
rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}" 2>/dev/null || true

Xvfb "$DISPLAY" -screen 0 "$VNC_GEOMETRY" -nolisten tcp &

# Sans cette attente, Chromium démarre avant le serveur X et échoue.
i=0
while ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 100 ] && echo "Xvfb n'a pas démarré" >&2 && exit 1
  sleep 0.1
done

# `-nopw` : l'écran n'est jamais exposé publiquement, il n'est joignable qu'à
# travers le proxy de l'application. Ne pas publier le port 5900 sur Internet.
x11vnc -display "$DISPLAY" -forever -shared -nopw -quiet -rfbport 5900 -bg

websockify --web=/usr/share/novnc "${VNC_PORT:-6080}" 127.0.0.1:5900 &

# Le volume des profils survit au conteneur, et Chromium y laisse un verrou
# désignant un processus d'une machine qui n'existe plus. Au démarrage, aucun
# navigateur ne tourne encore : tout verrou présent est donc périmé.
find "${BOT_PROFILE_DIR:-/data/profiles}" -maxdepth 2 -name 'Singleton*' -exec rm -rf {} + 2>/dev/null || true

exec node src/index.js
