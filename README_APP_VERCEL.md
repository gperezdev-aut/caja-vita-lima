# Caja Vita Lima — App Vercel

## Estado

Primera app web operativa de Caja Vita Lima en Next.js + Vercel + Supabase.

Incluye:

- Dashboard financiero.
- Reporte mensual.
- Alertas de salidas sin fecha.
- Resumen de comprobantes.
- Login simple por contraseña.
- Menú lateral base para próximos módulos.

## Variables necesarias en Vercel

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CAJA_APP_PASSWORD
CAJA_SESSION_SECRET
```

## Seguridad

`SUPABASE_SERVICE_ROLE_KEY` solo debe vivir en Vercel como variable de entorno.

No debe subirse a GitHub.

No debe llamarse `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.

## Login simple

La app usa:

```text
CAJA_APP_PASSWORD
CAJA_SESSION_SECRET
```

El login actual es temporal.

Después puede reemplazarse por usuarios y roles:

```text
ADMIN_GERALD
SOCIO
CAJA
LECTURA
TERAPISTA
```

## Próximos módulos

```text
Citas de hoy
Nueva atención / reserva
Registrar pago
Registrar salida
Comprobantes pendientes
Cierre de caja
```
