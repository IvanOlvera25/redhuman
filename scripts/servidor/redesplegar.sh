#!/usr/bin/env bash
# Despliega Red Human AI en producción desde el repo oficial.
#
#   uso:  /opt/redhuman/redesplegar.sh            → despliega origin/main
#         /opt/redhuman/redesplegar.sh --rama X   → despliega otra rama (a propósito)
#
# Reglas que este script impone, porque saltárselas ya tiró producción una vez:
#   · Solo despliega desde el repo oficial. Otros remotos requieren --forzar.
#   · La configuración vive en /opt/redhuman/config y NUNCA sale del repo.
#   · Respalda la base antes de tocar nada.
#   · Verifica al terminar; si algo queda mal, lo dice y sale con error.
set -uo pipefail

APP=/opt/redhuman/app
CONFIG=/opt/redhuman/config
RESPALDOS=/opt/redhuman/respaldos
OFICIAL="IvanOlvera25/redhuman"
RAMA=main
FORZAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --rama)   RAMA="$2"; shift 2 ;;
    --forzar) FORZAR=1; shift ;;
    *) echo "opción desconocida: $1"; exit 2 ;;
  esac
done

paso() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }
fallar() { printf "\033[31m✗ %s\033[0m\n" "$1"; exit 1; }

# ── 1. Comprobaciones previas ────────────────────────────────
paso "Comprobando de dónde se despliega"
cd "$APP" || fallar "no existe $APP"
remoto=$(git remote get-url origin 2>/dev/null)
case "$remoto" in
  *"$OFICIAL"*) echo "  origin: $remoto" ;;
  *)
    if [ "$FORZAR" -eq 1 ]; then
      echo "  ⚠ desplegando desde '$remoto' por --forzar"
    else
      fallar "origin es '$remoto', no el repo oficial ($OFICIAL).
   Producción solo debe seguir el repo oficial. Los cambios de otros forks
   entran por Pull Request. Si de verdad quieres desplegar esto, usa --forzar."
    fi
    ;;
esac

[ -f "$CONFIG/api.env" ] || fallar "falta $CONFIG/api.env — la configuración de producción no está donde debe"
[ -f "$CONFIG/web.env" ] || fallar "falta $CONFIG/web.env"

# ── 2. Respaldo de la base ───────────────────────────────────
paso "Respaldando la base"
mkdir -p "$RESPALDOS"
db_url=$(grep -E "^DATABASE_URL=" "$CONFIG/api.env" | cut -d= -f2-)
db_file=${db_url#sqlite:///}
if [ -f "$db_file" ]; then
  destino="$RESPALDOS/pre-deploy_$(date +%Y%m%d_%H%M%S).db"
  cp "$db_file" "$destino"
  echo "  $destino"
  # deja solo los 10 respaldos más recientes
  ls -1t "$RESPALDOS"/pre-deploy_*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  echo "  ⚠ no se encontró la base en $db_file"
fi

# ── 3. Traer el código ───────────────────────────────────────
paso "Actualizando código ($RAMA)"
git fetch origin --quiet || fallar "no se pudo hacer fetch"
git reset --hard "origin/$RAMA" --quiet || fallar "no se pudo posicionar en origin/$RAMA"
echo "  $(git rev-parse --short HEAD) — $(git log -1 --format=%s | cut -c1-70)"

# ── 4. Reponer los enlaces a la configuración ────────────────
# Va después del reset a propósito: si alguien dejó un .env de verdad en el
# repo, aquí se sustituye por el enlace a la configuración canónica.
paso "Enlazando la configuración canónica"
ln -sfn "$CONFIG/api.env" "$APP/red-human-api/.env"
ln -sfn "$CONFIG/web.env" "$APP/red-human-app/.env.local"
echo "  .env       → $CONFIG/api.env"
echo "  .env.local → $CONFIG/web.env"
chown -R redhuman:redhuman "$APP"

# ── 5. API ───────────────────────────────────────────────────
paso "API: dependencias y esquema"
cd "$APP/red-human-api" || fallar "falta red-human-api"
sudo -u redhuman .venv/bin/pip install -q -r requirements.txt || fallar "fallaron las dependencias de Python"
# la config se carga explícitamente: este python no hereda el EnvironmentFile de systemd
set -a; . "$CONFIG/api.env"; set +a
sudo -u redhuman --preserve-env=DATABASE_URL .venv/bin/python - <<'PY' || exit 1
from app.database import Base, engine
from app.migraciones import sincronizar
Base.metadata.create_all(bind=engine)
cambios = sincronizar(engine)
print("  columnas nuevas:", ", ".join(cambios) if cambios else "ninguna")
print("  base en uso:", engine.url)
PY

# ── 6. Frontend ──────────────────────────────────────────────
paso "Web: build de producción"
cd "$APP/red-human-app" || fallar "falta red-human-app"
sudo -u redhuman npm ci --no-audit --no-fund --silent || fallar "fallaron las dependencias de Node"
sudo -u redhuman npm run build >/dev/null || fallar "falló el build del frontend"
echo "  build completo"

# ── 7. Reinicio ──────────────────────────────────────────────
paso "Reiniciando servicios"
systemctl restart redhuman-api redhuman-web
sleep 7
curl -sf http://127.0.0.1:8000/salud >/dev/null || { journalctl -u redhuman-api -n 25 --no-pager; fallar "la API no responde"; }
curl -sf -o /dev/null http://127.0.0.1:3000/login || { journalctl -u redhuman-web -n 25 --no-pager; fallar "el frontend no responde"; }
echo "  api y web arriba"

# ── 8. Verificación ──────────────────────────────────────────
paso "Verificando producción"
/opt/redhuman/verificar.sh
