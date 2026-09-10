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

## Checkpoint y respaldo

Ejecutar en Contabo, dentro de `/opt/caja-vita-lima`:

```bash
git status -sb
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git log -1 --oneline

umask 077
BACKUP_ENV=".env.production.backup-$(date +%Y%m%d-%H%M%S)"
cp .env.production "$BACKUP_ENV"
chmod 600 "$BACKUP_ENV"

ROLLBACK_TAG="caja-vita-lima:rollback-$(date +%Y%m%d-%H%M%S)"
docker image inspect caja-vita-lima:local >/dev/null
docker tag caja-vita-lima:local "$ROLLBACK_TAG"
printf 'Rollback image: %s\n' "$ROLLBACK_TAG"
```

El respaldo de `.env.production` es privado: no abrirlo, imprimirlo ni subirlo
a Git. Antes de continuar, verificar solo los nombres obligatorios, sin cargar
sus valores en la sesión de shell:

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

## Validar y levantar

```bash
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d --build
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

Si falla la validación, reutilizar la imagen que se etiquetó antes del build:

```bash
docker tag "$ROLLBACK_TAG" caja-vita-lima:local
docker compose --env-file .env.production up -d --no-build
docker inspect --format '{{.State.Health.Status}}' caja-vita-lima
docker exec caja-vita-lima node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
```

No eliminar la etiqueta de rollback hasta que la revisión operativa haya sido
aceptada. El rollback no ejecuta SQL ni revierte las migraciones 013–017.
