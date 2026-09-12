# Contrato de fechas del ledger de pagos

## Contrato vigente desde la migración 021

- `citas_reservadas.fecha_cita` y `hora_cita`: fecha/hora operativa de la cita.
- `caja_movimientos.fecha` y `hora`: fecha/hora operativa de la cita o movimiento.
- `caja_pagos.fecha` y `hora`: fecha/hora real en que PostgreSQL registra el cobro en `America/Lima`.
- `caja_movimientos.total_pagado`: acumulado operativo conciliable por `movimiento_id`. No es la fuente temporal de caja diaria o mensual.
- Los cierres y los ingresos confirmados del dashboard usan `caja_pagos.monto`, agrupado por `caja_pagos.fecha` y `caja_pagos.sede`.

Las RPC `preparar_ficha_cita(jsonb)` y `preparar_atencion_personalizada(jsonb)` calculan un único `v_instante_cobro` con `now() at time zone 'America/Lima'`. Ninguna fecha u hora de pago enviada por el navegador participa en el insert de `caja_pagos`.

La idempotencia existente se conserva: `request_id` identifica la preparación, `request_fingerprint` detecta conflictos y el índice único parcial `uq_citas_request_id` resuelve carreras. Un reintento compatible devuelve el resultado existente antes de insertar otro pago.

## Cierre y caja física

El cierre obtiene ingresos desde `caja_pagos` y salidas desde `caja_salidas`; la acción vuelve a calcular ambos importes server-side y no confía en los totales del formulario. La interfaz muestra EFECTIVO, YAPE, PLIN, IZIPAY POS, BCP y OTRO.

`caja_salidas` no tiene método de desembolso. Por ello no puede saberse si cada salida redujo efectivo físico o una cuenta digital. Para nuevos cierres se persiste `caja_esperada = NULL` y `diferencia = NULL`; la interfaz muestra “No calculable”. Los totales operativos sí se conservan: `total_ingresos = sum(caja_pagos.monto)` y `total_salidas = sum(caja_salidas.monto)` por fecha real y sede.

No existe una fórmula de caja física en esta fase. En particular, no se resta `efectivo_contado` de un saldo que incluya Yape, Plin, POS o transferencias. Definir caja física exige una decisión de negocio y registrar el método de cada salida; esta fase no inventa esa regla. Los cierres históricos conservan sus valores anteriores y no se recalculan.

## Clasificación financiera

En `vista_reporte_financiero_mensual`, `ATENCION_HISTORICA`, `RESERVA_APP` y `ATENCION_APP` son ingresos de servicios: los dos tipos de app representan pagos vinculados a citas o atenciones. Se mantienen sin cambios las categorías independientes `GIFT_CARD_VENTA`, `PRESTAMO_CAJA_INGRESO` y `CUPONIDAD`. `total_ingresos_confirmados` continúa siendo la suma completa del ledger, por lo que la reclasificación no modifica el total general.

## Histórico y backfill

La migración no modifica filas históricas. La consulta [021_pagos_historicos_fecha_diagnostico_read_only.sql](../sql/diagnostics/021_pagos_historicos_fecha_diagnostico_read_only.sql) lista como señal principal los adelantos cuya `caja_pagos.fecha` coincide con la fecha operativa y difiere de la fecha Lima derivada de `created_at`.

`created_at` puede ayudar a priorizar revisión porque registra cuándo se insertó la fila. No equivale necesariamente al cobro: una importación por lotes, migración, carga tardía, corrección manual o reingreso puede ocurrir horas o meses después del pago real. Por eso no se usa como backfill automático; cualquier corrección histórica necesita evidencia externa y aprobación separada.

## Segundo pago

El esquema permite varios `caja_pagos` para un mismo `movimiento_id` porque la clave primaria es `pago_id`. El test SQL demuestra dos pagos en días distintos y la conciliación posterior con `total_pagado`. La interfaz para registrar el saldo durante reserva→atención queda fuera de esta fase.
