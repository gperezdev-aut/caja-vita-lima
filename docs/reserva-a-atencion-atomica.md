# Reserva existente a atención atómica

## Auditoría de estados previa

El esquema base usa texto libre para `caja_movimientos.estado`, `citas_reservadas.estado` y `tipo_movimiento`; no hay constraints que impongan una taxonomía global. Los flujos versionados existentes escriben:

| Campo | Valores observados relevantes |
| --- | --- |
| `caja_movimientos.tipo_movimiento` | `RESERVA_APP`, `ATENCION_APP`, `ATENCION_HISTORICA`, además de tipos financieros no relacionados |
| `caja_movimientos.estado` | `Reservado`, `Pendiente de confirmación`, `Registrado` |
| `citas_reservadas.estado` | `PENDIENTE`, `ATENDIDA_APP` |
| `citas_reservadas.estado_ficha` | `pendiente`, `completa` (constraint existente) |
| Comprobante en movimiento | `estado_boleta`: `Emitida`, `Pendiente`, `No aplica`, `Anulada`; `tipo_comprobante`: `BOLETA`, `FACTURA`, `NO_APLICA`; `estado_comprobante_manual`: `PENDIENTE`, `OK`, `OBSERVAR`, `NO_APLICA` |
| Solicitud de comprobante | `PENDIENTE`, `EMITIDO`, `ANULADO` (constraint existente) |

No se reescribe histórico. La transición mínima nueva es:

| Momento | Movimiento | Reserva |
| --- | --- | --- |
| Preparada | `RESERVA_APP` / `Reservado` | `PENDIENTE` |
| Iniciada con saldo | `ATENCION_APP` / `En atención` | `EN_ATENCION` |
| Sin saldo | `ATENCION_APP` / `Atendido` | `ATENDIDA_APP` |

Las reservas `Pendiente de confirmación` no se pueden iniciar hasta que `requiere_confirmacion` tenga `confirmado_en`.

## Contrato

`public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)` es `security definer`, fija `search_path = public, pg_temp` y sólo concede ejecución a `service_role`. Bloquea el movimiento, la reserva, sus pagos y detalles. Requiere que ambos IDs se referencien de forma cruzada, que compartan `cliente_id` y total, y que el acumulado del movimiento cuadre con `SUM(caja_pagos.monto)`.

La función actualiza todas las líneas existentes de cada persona con su terapista; esto preserva los componentes de atenciones personalizadas. Nunca inserta movimientos, reservas, clientes ni detalles. El adelanto y su fecha no se modifican. Si se recibe un saldo positivo, inserta un único `SALDO_ATENCION_APP` con la fecha/hora real de `America/Lima`.

La tabla server-only `caja_atencion_reserva_requests` conserva fingerprint y respuesta por `request_id`. Un replay idéntico devuelve la misma respuesta; un payload distinto con el mismo ID falla.

## Límite deliberado: extras

El modelo vigente sólo tiene `caja_movimientos.total_extras`, usado también para movilidad HOME. No existe catálogo ni ledger de líneas de extras que permita verificar nombre y precio contra estado persistido. Por eso esta versión acepta únicamente `extras: []`, preserva `total_extras` y `total_cobrar`, y rechaza cualquier extra con `EXTRAS_NO_SOPORTADOS_SIN_MODELO_AUDITABLE`. Habilitarlos requiere primero diseñar un catálogo/ledger auditable; no debe aceptarse el precio enviado por el navegador.

## Integridad preservada

- `movimiento_id`, `reserva_id`, `cliente_id`, WhatsApp, ficha, salud y servicio no se recrean ni se sustituyen.
- Los campos y la solicitud de comprobante no se modifican.
- Con saldo posterior mayor que cero queda `En atención`; no existe excepción de crédito.
- Dashboard y cierre siguen leyendo `caja_pagos.fecha`, de modo que adelanto y pago final aparecen en sus fechas reales.
- “Nueva atención” permanece sin cambios; “Citas de hoy” abre un flujo contextual para la reserva existente.
