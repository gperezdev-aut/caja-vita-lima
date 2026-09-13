# Gift Cards v1 — decisión técnica y contable

## Auditoría de integración

- `caja_pagos` es el ledger temporal de dinero real y alimenta dashboard, cierre y reportes.
- `caja_movimientos.total_pagado` es acumulado operativo; no debe usarse como segundo eje temporal.
- Los reportes ya clasifican `GIFT_CARD_VENTA` aparte de ingresos por servicios.
- La tabla legacy `gift_cards` se amplía; no se crea una contabilidad paralela.
- El servicio se resuelve en servidor desde el release activo de `caja_catalog_services`; la emisión conserva código, nombre, duración, precio, release y versión.

## Venta y canje

La emisión crea atómicamente Gift Card, movimiento `GIFT_CARD_VENTA`, pago `GIFT_CARD_VENTA` y evento de auditoría. La política vigente exige pago total. El canje crea una fila en `gift_card_usos` y un evento, pero no crea un nuevo `caja_pago`: así el cobro entra una sola vez y el uso no duplica ingresos.

El saldo monetario se reconstruye como `gift_cards.monto - sum(gift_card_usos.monto_usado)`. Cada canje bloquea la Gift Card con `FOR UPDATE`, por lo que dos transacciones concurrentes no consumen el mismo saldo.

La anulación es administrativa, conserva pago, movimiento e historial y no ejecuta devolución financiera automática.

## Seguridad y permisos

Las tablas tienen RLS y no conceden acceso a `public`, `anon` ni `authenticated`. Las RPC usan `SECURITY DEFINER`, `search_path` fijo y ejecución exclusiva de `service_role`. La service role permanece solo en el servidor.

La navegación habilita Gift Cards para `ADMIN_GERALD` y `VITA_OPERACION`, que son los perfiles autorizados por defecto para administrar/cobrar. `SOCIO` queda sin acceso hasta una autorización explícita. La anulación se limita adicionalmente a `ADMIN_GERALD`.

## Descarga

La ruta privada de descarga genera un SVG autónomo de 1600×1000 con el logo oficial incrustado. No usa servicios externos ni expone IDs, pagos o referencias internas.
