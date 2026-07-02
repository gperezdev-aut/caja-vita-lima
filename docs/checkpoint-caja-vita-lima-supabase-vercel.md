# Checkpoint — Caja Vita Lima Supabase/Vercel

Fecha: 2026-07-01

## Estado general

Se avanzó la migración de Caja Vita Lima desde Excel / Apps Script hacia una arquitectura nueva basada en:

```text
GitHub   → código, SQL y documentación
Supabase → base de datos y vistas
Vercel   → futura app web
n8n      → automatizaciones futuras
```

## Supabase

Proyecto creado:

```text
vita-lima-caja
```

## Migración cargada

Fuente inicial:

```text
1SEMESTRE2026
```

## Conteos validados

```text
clientes: 320
caja_movimientos: 458
caja_pagos: 533
caja_atencion_detalle: 554
caja_salidas: 136
gift_cards: 19
cupones_convenios: 29
migracion_revision: 139
```

## Montos validados

```text
total_pagado_movimientos: S/ 42,059.10
total_pagos:              S/ 42,059.10
total_salidas:            S/ 5,586.20
```

## Pagos por método

```text
IZIPAY POS: S/ 23,484.70
YAPE:       S/ 9,875.40
EFECTIVO:   S/ 5,193.50
PLIN:       S/ 1,991.50
BCP:        S/ 594.00
INTERBANK:  S/ 437.50
OTRO:       S/ 344.00
BBVA:       S/ 138.50
```

## Tipos de movimiento

```text
ATENCION_HISTORICA:      S/ 39,221.90
GIFT_CARD_VENTA:         S/ 2,427.90
PRESTAMO_CAJA_INGRESO:   S/ 299.50
CUPONIDAD:               S/ 109.80
```

## Reportes creados

```text
vista_dashboard_resumen_general
vista_ingresos_por_metodo
vista_ingresos_por_tipo_movimiento
vista_ingresos_por_mes
vista_salidas_por_tipo
vista_resultado_neto_por_mes
vista_reporte_financiero_mensual
vista_reporte_socio_mensual
vista_reporte_socio_mensual_resumen
vista_reporte_socio_mes_actual
```

## Alertas creadas

```text
vista_salidas_sin_fecha
vista_salidas_sin_fecha_resumen
vista_reporte_socio_resumen_con_alertas
vista_comprobantes_estado_general
vista_comprobantes_resumen
vista_comprobantes_control_editable
vista_comprobantes_control_resumen
vista_comprobantes_para_revisar
vista_reporte_socio_resumen_con_alertas_v3
```

## Salidas sin fecha

Detectado:

```text
13 salidas sin fecha
S/ 385.20
```

Estas salidas no se asignan automáticamente a un mes.

## Comprobantes editables

Estado actual:

```text
OK_COMPLETO: 225 registros — S/ 23,165.60
PENDIENTE:   183 registros — S/ 14,937.50
OBSERVAR:     43 registros — S/ 3,656.50
```

## Columnas nuevas agregadas a caja_movimientos

```text
tipo_comprobante
estado_comprobante_manual
numero_comprobante_final
fecha_emision_comprobante
observacion_comprobante
comprobante_revisado_por
comprobante_revisado_at
```

## Pendiente para app

Crear app en Next.js y desplegar en Vercel.

La app debe leer desde vistas de Supabase y mostrar:

```text
reporte mensual
resumen socio
alertas de salidas sin fecha
alertas de comprobantes
comprobantes para revisar
```

## Decisión

Antes de avanzar al panel WhatsApp CRM, se decidió cerrar primero la Caja Vita Lima visible en Vercel.
