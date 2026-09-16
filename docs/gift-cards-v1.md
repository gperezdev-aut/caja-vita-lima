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

## Reserva y ficha (migración 028)

`gift_card_reservas` separa el compromiso operativo del estado principal de la Gift Card. Un hold `ACTIVA` resta del saldo reservable; `LIBERADA` devuelve la cobertura sin crear uso; `CANJEADA` queda enlazada al uso creado al confirmar la atención. Las Gift Cards de servicio conservan exactamente su `service_code`, release, versión, nombre, duración y precio históricos. Las Gift Cards por monto usan el catálogo presencial activo y pueden comprometer sólo `min(saldo disponible, total de la cita)`.

La política de adelanto se calcula primero como una cita directa normal. La cobertura del hold reduce el efectivo mínimo adicional, pero nunca se inserta en `caja_pagos`. En la reserva y atención, `total_pagado` continúa siendo la suma de dinero real; `pendiente` se concilia como total menos pagos reales menos cobertura Gift Card. Al concretar la atención, el wrapper atómico crea el uso por el monto exacto del hold y sólo registra un pago si hubo dinero real adicional.

## Seguridad y permisos

Las tablas tienen RLS y no conceden acceso a `public`, `anon` ni `authenticated`. Las RPC usan `SECURITY DEFINER`, `search_path` fijo y ejecución exclusiva de `service_role`. La service role permanece solo en el servidor.

La navegación habilita Gift Cards para `ADMIN_GERALD` y `VITA_OPERACION`, que son los perfiles autorizados por defecto para administrar/cobrar. `SOCIO` queda sin acceso hasta una autorización explícita. La anulación se limita adicionalmente a `ADMIN_GERALD`.

## Descarga

La ruta privada de descarga genera un SVG autónomo de 1600×1000 con el logo oficial incrustado. No usa servicios externos ni expone IDs, pagos o referencias internas.
