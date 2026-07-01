# Tablas de revisión y corrección de migración — Caja Vita Lima

## Objetivo

Crear una bandeja de revisión para filas dudosas o mal clasificadas durante la migración de la caja real de Vita Lima.

La migración no debe ser rígida. Debe permitir revisar, reclasificar y corregir movimientos sin perder trazabilidad.

---

## Problema que resuelve

Durante la transformación del Excel real pueden aparecer casos como:

```text
- Una fila parece atención normal, pero era Apoyo Therapy.
- Una fila parece ingreso, pero era préstamo.
- Una fila parece Gift Card, pero era uso de Gift Card.
- Una fila tiene servicio pero no tiene monto.
- Una fila tiene salida mezclada con ingreso.
- Una fila fue importada mal y luego necesita corrección.
```

Para evitar errores financieros, estas filas deben poder revisarse antes o después de la importación.

---

## Tablas nuevas

### migracion_revision

Guarda filas dudosas o pendientes de clasificación.

Campos clave:

```text
revision_id
archivo_origen
hoja_origen
fila_origen
cliente_original
servicio_original
terapista_original
monto_ingreso_detectado
monto_salida_detectado
tipo_sugerido
estado_revision
tipo_final
comentario_revision
revisado_por
tabla_destino
registro_destino_id
```

Estados sugeridos:

```text
PENDIENTE
CONFIRMADO
RECLASIFICADO
IGNORADO
IMPORTADO
CORREGIDO
```

Tipos sugeridos/finales:

```text
ATENCION_HISTORICA
APOYO_THERAPY
GIFT_CARD_VENTA
BEE_BENEFICIOS
CUPONIDAD
PRESTAMO_CAJA_INGRESO
DEVOLUCION_PRESTAMO_CAJA
SALIDA
IGNORAR
REVISAR_DESPUES
```

---

### migracion_correcciones

Guarda el historial de cambios cuando un registro ya importado se corrige.

Ejemplo:

```text
Antes:
tipo_movimiento = ATENCION_HISTORICA

Después:
tipo_movimiento = PRESTAMO_CAJA_INGRESO
```

Campos clave:

```text
correccion_id
tabla_afectada
registro_id
campo_modificado
valor_anterior
valor_nuevo
tipo_correccion
motivo
corregido_por
created_at
```

---

## Vistas nuevas

### vista_migracion_revision_pendiente

Muestra solo filas pendientes de revisión.

Uso:

```sql
select * from public.vista_migracion_revision_pendiente;
```

---

### vista_migracion_revision_resumen

Resume filas por estado y tipo sugerido.

Uso:

```sql
select * from public.vista_migracion_revision_resumen;
```

---

## Flujo recomendado

```text
Excel real
   ↓
Transformador automático
   ↓
Filas claras → CSV de importación
   ↓
Filas dudosas → migracion_revision
   ↓
Gerald revisa y confirma/reclasifica
   ↓
Se importan o corrigen registros
   ↓
Toda corrección queda en migracion_correcciones
```

---

## Regla clave

Ningún movimiento dudoso debe entrar como venta normal sin revisión.

Todo registro debe conservar:

```text
source_type
source_id
hoja_origen
fila_origen
```

Así siempre se puede rastrear desde Supabase hasta la fila original del Excel.

---

## Estado

```text
SQL preparado: sql/004_migration_review_tables.sql
Documento preparado: docs/revision-y-correccion-migracion.md
Pendiente: ejecutar SQL en Supabase
Pendiente: adaptar transformación v2 para usar migracion_revision
```
