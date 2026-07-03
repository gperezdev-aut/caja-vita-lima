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

## Variables necesarias en Vercel

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CAJA_APP_PASSWORD
CAJA_SESSION_SECRET
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

## Próximos módulos

```text
Citas de hoy
Registrar salida
Comprobantes pendientes editables
Cierre de caja
```
