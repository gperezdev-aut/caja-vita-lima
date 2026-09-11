# Catálogo canónico — Fase 3B.0-B

Esta fase prepara, sin aplicar SQL ni activar flujos, la cadena:

`Web → catálogo canónico → snapshot local de Caja → futura RPC canónica`.

El snapshot local **NO es una fuente de verdad editable**. Solo la RPC privada
`caja_import_catalog_snapshot_v1` puede insertar una release validada y activar
su copia completa. Servicios, precios y reglas HOME quedan inmutables; un
reintento con contenido idéntico es idempotente y cualquier diferencia para la
misma release se rechaza.

El contrato local conserva `valid_from`, `valid_to` y `price_version`, los
mesmos nombres del catálogo canónico; no usa aliases `effective_*`. La
migración 019 exige que el snapshot esté vacío antes de alinear 018 y preserva
la versión de precio que originó cada copia.

La sincronización administrativa requiere `ADMIN_GERALD`, usa las dos
conexiones server-side separadas y está apagada por defecto mediante
`CATALOG_SNAPSHOT_SYNC_ENABLED=false`. Nunca expone claves, URLs privadas ni
el payload completo. La lectura runtime de Fase 3A no se reemplaza todavía.

Para sincronizar el snapshot, Caja consume del catálogo remoto únicamente
`catalog_services_read_v1`, `catalog_home_policy_read_v1` y la RPC privada
`catalog_get_snapshot_metadata_v1`. Caja no lee directamente
`catalog_releases` ni `catalog_home_policy_manifests_v1`; la RPC devuelve la
metadata mínima del release PUBLISHED y del único manifest HOME activo.

La conexión canónica queda hoy limitada por allowlist al proyecto de staging.
Producción es NO-GO mientras no exista una allowlist explícita por environment
o una validación equivalente de project ref; nunca se aceptará una URL canónica
arbitraria.

Fase 3B.0-B no cambia **Preparar cita** ni **Nueva atención**. Ambas continúan
en legacy, igual que los componentes personalizados: los 50 servicios tienen
`component_eligibility_status=PENDING_REVIEW` y no habilitan componentes.

Después del merge y una autorización separada se aplicará `sql/018...` al
entorno operativo de Caja, se ejecutará el harness con `ROLLBACK` y se hará una
sincronización controlada del release `catalog-v1-web-4104385`.
