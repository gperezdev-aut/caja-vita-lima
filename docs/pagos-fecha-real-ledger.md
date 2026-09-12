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

`caja_salidas` no tiene método de desembolso. Por ello no puede saberse si cada salida redujo efectivo físico o una cuenta digital. La fórmula histórica almacenada en `caja_cierres.caja_esperada` se conserva como saldo operativo (`caja_inicial + pozo_fondo + ingresos totales - salidas totales`), pero no debe interpretarse como caja física. Definir caja física exige una decisión de negocio y registrar el método de cada salida; esta fase no inventa esa regla.

## Histórico y backfill

La migración no modifica filas históricas. La consulta [021_pagos_historicos_fecha_diagnostico_read_only.sql](../sql/diagnostics/021_pagos_historicos_fecha_diagnostico_read_only.sql) lista como señal principal los adelantos cuya `caja_pagos.fecha` coincide con la fecha operativa y difiere de la fecha Lima derivada de `created_at`.

`created_at` puede ayudar a priorizar revisión porque registra cuándo se insertó la fila. No equivale necesariamente al cobro: una importación por lotes, migración, carga tardía, corrección manual o reingreso puede ocurrir horas o meses después del pago real. Por eso no se usa como backfill automático; cualquier corrección histórica necesita evidencia externa y aprobación separada.

## Segundo pago

El esquema permite varios `caja_pagos` para un mismo `movimiento_id` porque la clave primaria es `pago_id`. El test SQL demuestra dos pagos en días distintos y la conciliación posterior con `total_pagado`. La interfaz para registrar el saldo durante reserva→atención queda fuera de esta fase.
