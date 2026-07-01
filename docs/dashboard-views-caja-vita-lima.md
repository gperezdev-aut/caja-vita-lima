# Dashboard Views — Caja Vita Lima

## Objetivo

Crear vistas SQL para consultar rápidamente la información migrada a Supabase sin entrar tabla por tabla.

Estas vistas serán la base para la futura app web en Next.js y para reportes financieros de Vita Lima.

---

## Archivo SQL relacionado

```text
sql/005_dashboard_views.sql
```

---

## Vistas creadas

### vista_dashboard_resumen_general

Resumen general de KPIs:

```text
total_clientes
total_movimientos
total_ingresos_movimientos
total_pagos
total_ingresos_pagos
total_salidas
total_gift_cards
total_cupones_convenios
total_revision_pendiente
```

### vista_ingresos_por_metodo

Resume pagos por método.

### vista_ingresos_por_tipo_movimiento

Resume ingresos por tipo de movimiento.

### vista_ingresos_por_fecha

Resumen diario de ingresos.

### vista_ingresos_por_mes

Resumen mensual de ingresos por sede.

### vista_salidas_por_tipo

Resumen de gastos/salidas por tipo.

### vista_salidas_por_fecha

Resumen diario de salidas.

### vista_resultado_neto_por_mes

Cruza ingresos y salidas para obtener resultado neto mensual.

### vista_gift_cards_resumen

Resume ventas de Gift Cards por estado.

### vista_cupones_convenios_resumen

Resume Bee Beneficios, Cuponidad y otros convenios.

### vista_revision_pendiente_resumen

Resume la bandeja de pendientes de migración.

### vista_boletas_pendientes

Lista movimientos con boleta pendiente.

### vista_dashboard_operativo

Vista consolidada para futura pantalla de dashboard operativo.

---

## Estado

```text
SQL preparado: pendiente de ejecutar en Supabase.
Base actual: 1SEMESTRE2026 V2 importado.
Objetivo siguiente: validar vistas y usarlas como base del dashboard.
```
