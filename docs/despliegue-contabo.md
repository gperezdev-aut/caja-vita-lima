# Despliegue de Caja Vita Lima en Contabo

Esta guía aplica al servidor existente donde Nginx publica Caja por la red
externa `n8n_default`. No publica el puerto 3000 en el host y no modifica
Supabase, n8n, Contabo ni las migraciones desde el contenedor.

## Precondiciones

- Directorio de aplicación: `/opt/caja-vita-lima`.
- Archivo privado existente: `/opt/caja-vita-lima/.env.production`.
- Red Docker externa existente: `n8n_default`.
- Nginx continúa usando `proxy_pass http://caja-vita-lima:3000`.
- Las migraciones 013–017 ya están aplicadas: **no ejecutar SQL ni
  migraciones** durante este procedimiento.

## Checkpoint, respaldo y estado de rollback

Ejecutar en Contabo, dentro de `/opt/caja-vita-lima`:

```bash
git status -sb
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git log -1 --oneline

umask 077
DEPLOY_ID="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
BACKUP_DIR="/opt/backups/caja-vita-lima"
install -d -m 700 "$BACKUP_DIR"

ENV_BACKUP="$BACKUP_DIR/.env.production.backup-$DEPLOY_ID"
cp .env.production "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"

PREVIOUS_CONTAINER_NAME="$(docker inspect --format '{{.Name}}' caja-vita-lima | sed 's#^/##')"
ROLLBACK_CONTAINER_NAME="${PREVIOUS_CONTAINER_NAME}-rollback-$DEPLOY_ID"
ROLLBACK_TAG="caja-vita-lima:rollback-$DEPLOY_ID"
docker image inspect caja-vita-lima:local >/dev/null
docker tag caja-vita-lima:local "$ROLLBACK_TAG"

STATE_FILE="$BACKUP_DIR/deploy-$DEPLOY_ID.env"
{
  printf 'PREVIOUS_CONTAINER_NAME=%q\n' "$PREVIOUS_CONTAINER_NAME"
  printf 'ROLLBACK_CONTAINER_NAME=%q\n' "$ROLLBACK_CONTAINER_NAME"
  printf 'ROLLBACK_TAG=%q\n' "$ROLLBACK_TAG"
  printf 'ENV_BACKUP=%q\n' "$ENV_BACKUP"
} > "$STATE_FILE"
chmod 600 "$STATE_FILE"
printf 'Rollback state: %s\n' "$STATE_FILE"
```

El respaldo de `.env.production` es privado: no abrirlo, imprimirlo ni subirlo
a Git. El archivo de estado queda fuera del repositorio y persiste el nombre
del contenedor manual, su nombre de rollback, la etiqueta de imagen y la ruta
del respaldo para que el rollback no dependa de la sesión SSH. Antes de
continuar, verificar solo los nombres obligatorios, sin cargar sus valores en
la sesión de shell:

```bash
for key in \
  SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CAJA_APP_PASSWORD \
  CAJA_SESSION_SECRET CAJA_API_SECRET CAJA_POLITICA_CANCELACION_URL \
  CAJA_WHATSAPP_NEGOCIO; do
  grep -Eq "^${key}=.+" .env.production || { printf 'Falta variable: %s\n' "$key" >&2; exit 1; }
done
```

La validación Compose del siguiente paso confirma que ninguna de esas variables
esté vacía; sus valores no se imprimen.

## Validar, construir y transición inicial

El contenedor actual fue creado manualmente y usa el nombre
`caja-vita-lima`. Docker Compose no puede crear otro contenedor con ese mismo
nombre: no ejecutar `up` antes de detenerlo y renombrarlo. La imagen se
construye una sola vez.

```bash
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build

docker stop "$PREVIOUS_CONTAINER_NAME"
docker rename "$PREVIOUS_CONTAINER_NAME" "$ROLLBACK_CONTAINER_NAME"
docker compose --env-file .env.production up -d --no-build
```

Esperar el healthcheck sin mostrar variables ni contenidos de configuración:

```bash
for attempt in $(seq 1 18); do
  status="$(docker inspect --format '{{.State.Health.Status}}' caja-vita-lima 2>/dev/null || true)"
  test "$status" = healthy && break
  sleep 5
done
test "$status" = healthy
docker compose logs --tail=100 caja-vita-lima
docker exec caja-vita-lima node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
curl --fail --silent --show-error --output /dev/null https://caja.vitalimaspa.com/login
```

Revisar los logs visualmente sin copiar ni publicar secretos. No ejecutar
`docker volume prune` ni `docker system prune` durante el despliegue.

## Rollback exacto

Si falla la validación, usar el estado persistido incluso si se cerró la sesión
SSH. Sustituir la ruta solo por la que imprimió el checkpoint; el archivo no
contiene secretos.

```bash
STATE_FILE="/opt/backups/caja-vita-lima/deploy-<DEPLOY_ID>.env"
. "$STATE_FILE"

docker compose --env-file .env.production stop caja-vita-lima || true
docker compose --env-file .env.production rm -f caja-vita-lima || true
install -m 600 "$ENV_BACKUP" .env.production
docker rename "$ROLLBACK_CONTAINER_NAME" "$PREVIOUS_CONTAINER_NAME"
docker start "$PREVIOUS_CONTAINER_NAME"
docker exec caja-vita-lima node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
curl --fail --silent --show-error --output /dev/null https://caja.vitalimaspa.com/login
```

No eliminar el contenedor manual renombrado ni la etiqueta de rollback hasta
que la revisión operativa haya sido aceptada. El rollback no ejecuta SQL ni
revierte las migraciones 013–017.
