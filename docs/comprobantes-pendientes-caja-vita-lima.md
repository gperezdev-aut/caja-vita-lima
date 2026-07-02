# Comprobantes pendientes — Caja Vita Lima

## Objetivo

Controlar boletas, facturas y comprobantes pendientes o incompletos dentro de la caja migrada a Supabase.

---

## Archivo SQL relacionado

```text
sql/009_comprobantes_pendientes.sql
```

---

## Contexto

En la caja histórica pueden existir registros con:

```text
- estado de boleta pendiente
- estado de boleta vacío
- número de boleta vacío
- estado OK pero sin número
- comprobantes anulados u observados
```

La tabla actual `caja_movimientos` tiene:

```text
estado_boleta
numero_boleta
```

Todavía no tiene una columna separada para:

```text
tipo_comprobante
```

Por eso esta versión usa `estado_boleta` y `numero_boleta`.

---

## Vistas creadas

### vista_comprobantes_estado_general

Clasifica todos los movimientos según estado de comprobante.

Estados posibles:

```text
NO_APLICA_PRESTAMO
SIN_ESTADO_Y_SIN_NUMERO
SIN_ESTADO_CON_NUMERO
COMPROBANTE_PENDIENTE
COMPROBANTE_ANULADO_REVISION
OK_SIN_NUMERO
SIN_NUMERO_COMPROBANTE
OK_CON_NUMERO
```

---

### vista_comprobantes_pendientes

Lista solo movimientos que requieren revisión de comprobante.

Consulta:

```sql
select *
from public.vista_comprobantes_pendientes;
```

---

### vista_comprobantes_resumen

Resumen por estado calculado.

Consulta:

```sql
select *
from public.vista_comprobantes_resumen;
```

---

### vista_comprobantes_sin_numero

Lista movimientos sin número de comprobante.

Consulta:

```sql
select *
from public.vista_comprobantes_sin_numero;
```

---

### vista_comprobantes_valores_origen

Muestra los valores originales encontrados en `estado_boleta`.

Sirve para ajustar reglas futuras.

Consulta:

```sql
select *
from public.vista_comprobantes_valores_origen;
```

---

### vista_reporte_socio_alertas_comprobantes

Resumen de alertas de comprobantes.

Consulta:

```sql
select *
from public.vista_reporte_socio_alertas_comprobantes;
```

---

### vista_reporte_socio_resumen_con_alertas_v2

Une el resumen financiero, salidas sin fecha y alertas de comprobantes.

Consulta:

```sql
select *
from public.vista_reporte_socio_resumen_con_alertas_v2;
```

---

## Regla operativa

Los comprobantes pendientes o sin número:

```text
- No bloquean la migración.
- No se eliminan.
- Se muestran como alerta.
- Se pueden revisar después.
```

---

## Mejora futura recomendada

Agregar en la tabla `caja_movimientos` una columna nueva:

```text
tipo_comprobante
```

Valores sugeridos:

```text
BOLETA
FACTURA
SIN_COMPROBANTE
NO_APLICA
PENDIENTE
```

Eso permitirá diferenciar mejor boletas y facturas en la app final.
