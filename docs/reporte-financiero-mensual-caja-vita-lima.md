# Reporte financiero mensual — Caja Vita Lima

## Objetivo

Crear una vista mensual más clara para socios, reportes y futura app.

La vista separa ingresos confirmados, salidas, resultado neto, gift cards, préstamos, cupones/convenios y pendientes de revisión.

---

## Archivo SQL relacionado

```text
sql/006_reporte_financiero_mensual.sql
```

---

## Vistas creadas

### vista_reporte_financiero_mensual

Vista completa.

Columnas principales:

```text
mes
sede
ingresos_servicios
ingresos_gift_cards
prestamos_caja
ingresos_cuponidad_en_caja
otros_ingresos
total_ingresos_confirmados
total_salidas
resultado_neto_confirmado
bee_monto_reconocido
bee_cobrado_tienda
cuponidad_monto_reconocido
cuponidad_cobrado_tienda
total_cupones_convenios
pendientes_revision
monto_ingreso_pendiente_revision
monto_salida_pendiente_revision
total_movimientos
total_salidas_registros
```

---

### vista_reporte_financiero_mensual_simple

Vista reducida para lectura rápida.

Columnas:

```text
mes
sede
ingresos_servicios
ingresos_gift_cards
prestamos_caja
total_ingresos_confirmados
total_salidas
resultado_neto_confirmado
pendientes_revision
```

---

## Para consultar en Supabase

Vista completa:

```sql
select *
from public.vista_reporte_financiero_mensual;
```

Vista simple:

```sql
select *
from public.vista_reporte_financiero_mensual_simple;
```

---

## Cómo interpretar

### ingresos_servicios

Ventas normales de spa.

### ingresos_gift_cards

Ventas de Gift Cards. No significa uso de Gift Card.

### prestamos_caja

Dinero que entró a caja como préstamo. No debe mezclarse con venta comercial.

### total_ingresos_confirmados

Suma de ingresos confirmados en `caja_movimientos`.

### total_salidas

Gastos o egresos registrados en `caja_salidas`.

### resultado_neto_confirmado

```text
total_ingresos_confirmados - total_salidas
```

### pendientes_revision

Filas dudosas que quedaron separadas en `migracion_revision`.

---

## Estado

```text
SQL preparado.
Pendiente: subir a GitHub.
Pendiente: ejecutar en Supabase.
```
