# Caja Vita Lima — App Vercel Starter

## Objetivo

Primera versión visual de Caja Vita Lima en Next.js + Vercel + Supabase.

Esta app muestra:

- Reporte financiero mensual.
- Resumen ejecutivo para socio.
- Ingresos por servicios.
- Gift Cards.
- Préstamos de caja.
- Salidas.
- Resultado neto.
- Salidas sin fecha.
- Comprobantes para revisar.

## Seguridad

Esta app usa `SUPABASE_SERVICE_ROLE_KEY` solo del lado servidor.

No debes crear variables con `NEXT_PUBLIC_` para el service role key.

## Variables necesarias en Vercel

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Vistas requeridas en Supabase

```text
vista_reporte_socio_resumen_con_alertas_v3
vista_reporte_socio_mensual
vista_reporte_socio_mes_actual
vista_comprobantes_control_resumen
vista_salidas_sin_fecha_resumen
```

## Deploy

1. Subir estos archivos al repo `caja-vita-lima`.
2. Entrar a Vercel.
3. Importar el repo desde GitHub.
4. Configurar variables de entorno.
5. Deploy.
