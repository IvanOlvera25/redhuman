#!/usr/bin/env bash
# Regresa producción al estado anterior al último despliegue.
#
#   uso:  /opt/redhuman/revertir.sh                 → vuelve al punto anterior al último deploy
#         /opt/redhuman/revertir.sh --lista         → muestra los puntos de retorno disponibles
#         /opt/redhuman/revertir.sh --punto NOMBRE  → vuelve a un punto concreto
#         /opt/redhuman/revertir.sh --con-base      → además restaura la base de ese punto
#         /opt/redhuman/revertir.sh --si            → no pregunta (para automatizar)
#
# Por omisión revierte SOLO el código. La base se deja como está, porque
# restaurarla descarta todo lo que candidatos y RH hayan hecho desde el
# despliegue. Usa --con-base únicamente si el problema es la base misma.
set -uo pipefail

APP=/opt/redhuman/app
CONFIG=/opt/redhuman/config
RESPALDOS=/opt/redhuman/respaldos
PUNTO=""
CON_BASE=0
SIN_PREGUNTAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --lista)     LISTAR=1; shift ;;
    --punto)     PUNTO="$2"; shift 2 ;;
    --con-base)  CON_BASE=1; shift ;;
    --si)        SIN_PREGUNTAR=1; shift ;;
    *) echo "opción desconocida: $1"; exit 2 ;;
  esac
done

paso()   { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }
fallar() { printf "\033[31m✗ %s\033[0m\n" "$1"; exit 1; }

cd "$APP" || fallar "no existe $APP"

# ── Puntos de retorno ────────────────────────────────────────
# redesplegar.sh deja un .commit (código) y un .db (base) por cada despliegue.
if [ "${LISTAR:-0}" = "1" ]; then
  echo "Puntos de retorno disponibles (el más reciente primero):"
  echo
  for c in $(ls -1t "$RESPALDOS"/pre-deploy_*.commit 2>/dev/null); do
    nombre=$(basename "$c" .commit)
    sha=$(cat "$c")
    base="$RESPALDOS/$nombre.db"
    [ -f "$base" ] && con_base="con base" || con_base="sin base"
    printf "  %-28s %s  %s  %s\n" "$nombre" "$(git log -1 --format=%h "$sha" 2>/dev/null || echo '???????')" \
           "$con_base" "$(git log -1 --format=%s "$sha" 2>/dev/null | cut -c1-45)"
  done
  exit 0
fi

if [ -z "$PUNTO" ]; then
  ultimo=$(ls -1t "$RESPALDOS"/pre-deploy_*.commit 2>/dev/null | head -1)
  [ -n "$ultimo" ] || fallar "no hay puntos de retorno en $RESPALDOS.
   Solo existen a partir del primer despliegue hecho con redesplegar.sh."
  PUNTO=$(basename "$ultimo" .commit)
fi

archivo_commit="$RESPALDOS/$PUNTO.commit"
archivo_base="$RESPALDOS/$PUNTO.db"
[ -f "$archivo_commit" ] || fallar "no existe el punto '$PUNTO' (pruébalo con --lista)"

sha=$(cat "$archivo_commit")
git cat-file -e "$sha^{commit}" 2>/dev/null || fallar "el commit $sha ya no está en el repositorio local"

# ── Confirmación ─────────────────────────────────────────────
actual=$(git rev-parse --short HEAD)
paso "Vas a revertir producción"
echo "  punto:   $PUNTO"
echo "  de:      $actual — $(git log -1 --format=%s | cut -c1-60)"
echo "  a:       $(git log -1 --format=%h "$sha") — $(git log -1 --format=%s "$sha" | cut -c1-60)"
if [ "$CON_BASE" = "1" ]; then
  [ -f "$archivo_base" ] || fallar "pediste --con-base pero no hay respaldo de base para '$PUNTO'"
  printf "  base:    \033[33mse restaura — se pierde todo lo capturado desde el despliegue\033[0m\n"
else
  echo "  base:    se conserva tal cual (usa --con-base para restaurarla)"
fi

if [ "$SIN_PREGUNTAR" != "1" ]; then
  printf "\n¿Continuar? [escribe 'si'] "
  read -r respuesta
  [ "$respuesta" = "si" ] || { echo "cancelado"; exit 0; }
fi

# ── Detener servicios ────────────────────────────────────────
# Antes de tocar código o base: evita copiar la base mientras se escribe.
paso "Deteniendo servicios"
systemctl stop redhuman-api redhuman-web
echo "  detenidos"

# ── Base ─────────────────────────────────────────────────────
db_url=$(grep -E "^DATABASE_URL=" "$CONFIG/api.env" | cut -d= -f2-)
db_file=${db_url#sqlite:///}

paso "Base de datos"
if [ -f "$db_file" ]; then
  # La reversa también se puede revertir: guarda la base actual antes de nada.
  seguro="$RESPALDOS/pre-revert_$(date +%Y%m%d_%H%M%S).db"
  cp "$db_file" "$seguro" && echo "  base actual guardada en $seguro"
fi
if [ "$CON_BASE" = "1" ]; then
  cp "$archivo_base" "$db_file" || fallar "no se pudo restaurar la base"
  # Sin esto la base queda de root y el servicio no puede escribir: nadie inicia sesión.
  chown redhuman:redhuman "$db_file"
  chmod 644 "$db_file"
  echo "  restaurada desde $PUNTO"
else
  echo "  sin cambios"
fi

# ── Código ───────────────────────────────────────────────────
paso "Regresando el código"
git reset --hard "$sha" --quiet || fallar "no se pudo posicionar en $sha"
echo "  $(git rev-parse --short HEAD) — $(git log -1 --format=%s | cut -c1-70)"

# El reset pudo dejar .env como archivo del repo: repón los enlaces.
ln -sfn "$CONFIG/api.env" "$APP/red-human-api/.env"
ln -sfn "$CONFIG/web.env" "$APP/red-human-app/.env.local"
chown -R redhuman:redhuman "$APP"
echo "  configuración enlazada"

# ── Reconstruir ──────────────────────────────────────────────
# El código viejo puede necesitar dependencias distintas a las del código nuevo.
paso "API: dependencias"
cd "$APP/red-human-api" || fallar "falta red-human-api"
sudo -u redhuman .venv/bin/pip install -q -r requirements.txt || fallar "fallaron las dependencias de Python"
echo "  listas"

paso "Web: build de producción"
cd "$APP/red-human-app" || fallar "falta red-human-app"
sudo -u redhuman npm ci --no-audit --no-fund --silent || fallar "fallaron las dependencias de Node"
sudo -u redhuman npm run build >/dev/null || fallar "falló el build del frontend"
echo "  build completo"

# ── Arrancar y verificar ─────────────────────────────────────
paso "Arrancando servicios"
systemctl start redhuman-api redhuman-web
sleep 7
curl -sf http://127.0.0.1:8000/salud >/dev/null || { journalctl -u redhuman-api -n 25 --no-pager; fallar "la API no responde"; }
curl -sf -o /dev/null http://127.0.0.1:3000/login || { journalctl -u redhuman-web -n 25 --no-pager; fallar "el frontend no responde"; }
echo "  api y web arriba"

paso "Verificando producción"
/opt/redhuman/verificar.sh
estado=$?

printf "\n\033[1mProducción quedó en %s.\033[0m\n" "$(git rev-parse --short HEAD)"
echo "El servidor ya no sigue a main: el próximo redesplegar.sh lo vuelve a adelantar,"
echo "así que arregla la causa y súbela por Pull Request antes de volver a desplegar."
exit $estado
