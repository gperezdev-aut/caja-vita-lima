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

Las migraciones `013`, `014`, `015` y `016` ya fueron aplicadas y validadas
manualmente en Supabase. La `016` conserva las firmas de las RPC, agrega
idempotencia por `request_id` y separa las solicitudes de comprobante. Ninguna
migración se ejecuta durante el despliegue.

El MVP de `/preparar-cita` admite únicamente citas directas presenciales o a
domicilio. Cuponidad, Bee Beneficios, promociones y gift cards siguen usando el
proceso operativo anterior hasta definir su economía completa.

La confirmación operativa mediante botón interno será un módulo posterior. No
se implementan todavía liberación de horarios ni devoluciones sin una política
económica aprobada.

El token público vence al terminar la duración completa de la cita o después;
el instante exacto `inicio + duracion_min` es válido.

La identificación opcional de clientes recurrentes usa
`POST /api/publico/ficha/:token/identificar`, contrato
`ficha-recurrente-v1`. Compara el teléfono normalizado solo contra el cliente de
esa reserva y, tras coincidir, recupera perfil, última declaración de salud y
último comprobante. Es servidor-a-servidor, requiere `CAJA_API_SECRET`, no usa
cache y no modifica datos operativos. No necesita una migración 017.

## Próximos módulos

```text
Citas de hoy
Registrar salida
Comprobantes pendientes editables
Cierre de caja
```
