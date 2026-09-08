# Caja Vita Lima — App Vercel

## Estado

App web operativa de Caja Vita Lima en Next.js + Vercel + Supabase.

Incluye:

- Dashboard financiero.
- Reporte mensual.
- Alertas de salidas sin fecha.
- Resumen de comprobantes.
- Login simple por contraseña.
- Primer formulario operativo: Nueva atención / reserva.
- Preparación transaccional de citas y generación de ficha pública.

## Variables necesarias en Vercel

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CAJA_APP_PASSWORD
CAJA_SESSION_SECRET
CAJA_API_SECRET
CAJA_POLITICA_CANCELACION_URL
CAJA_WHATSAPP_NEGOCIO
```

## Nueva atención / reserva

Ruta:

```text
/nueva-atencion
```

Guarda información en estas tablas:

```text
clientes
citas_reservadas
caja_movimientos
caja_pagos
caja_atencion_detalle
```

## Preparar ficha de cita

Ruta interna:

```text
/preparar-cita
```

Requiere ejecutar manualmente, en orden, las migraciones `013` y `014`.
La `014` crea la RPC transaccional que guarda cliente, movimiento, reserva,
pago y detalle antes de conservar el token. Ninguna de estas migraciones se
ejecuta automáticamente durante el despliegue.

## Próximos módulos

```text
Citas de hoy
Registrar salida
Comprobantes pendientes editables
Cierre de caja
```
