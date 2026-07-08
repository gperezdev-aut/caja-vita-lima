# Prompt para continuar Caja Vita Lima — Supabase/Vercel

Estoy continuando el proyecto **Caja Vita Lima — Supabase/Vercel**.

Stack actual:

- GitHub: código, SQL y documentación.
- Supabase: base de datos PostgreSQL, tablas y vistas.
- Vercel: app web en Next.js.
- n8n: automatizaciones futuras.
- App actual: https://caja-vita-lima.vercel.app
- Repo: gperezdev-aut/caja-vita-lima
- Supabase project: vita-lima-caja

Reglas:

- Respóndeme siempre en español.
- Dame pasos claros y uno por uno.
- Cuando me des código, dame archivos completos o patches claros.
- No me pidas pegar claves privadas.
- No expongas secrets.
- Antes de avanzar fuerte, valida que lo anterior esté funcionando.
- Si aparece error en Vercel o Supabase, ayúdame a corregirlo paso a paso.

Estado validado al 2026-07-07:

- Login por usuario funcionando.
- Roles básicos funcionando.
- Menú según rol funcionando.
- Dashboard funcionando.
- Dashboard con filtros por periodo y sede funcionando.
- Nueva atención funcionando.
- Citas de hoy funcionando.
- Registrar salida funcionando.
- Comprobantes editables funcionando.
- Cierre de caja funcionando.
- Limpieza de pruebas validada.

Usuarios activos:

- gerald / ADMIN_GERALD
- luis / SOCIO
- nati / SOCIO
- vita / VITA_OPERACION

Módulos principales:

- `/`
- `/citas-hoy`
- `/nueva-atencion`
- `/registrar-salida`
- `/comprobantes`
- `/cierre-caja`

Dashboard general validado:

- Ingresos confirmados: S/ 42,059.10
- Total salidas: S/ 5,201.00
- Resultado neto: S/ 36,858.10
- Pendientes migración: 90

Dashboard filtrado validado:

Mayo + junio 2026, todas las sedes:

- Ingresos confirmados: S/ 16,432.90
- Total salidas: S/ 1,297.40
- Resultado neto: S/ 15,135.50
- Pendientes migración: 29

Junio 2026, Miraflores:

- Ingresos confirmados: S/ 4,487.80
- Total salidas: S/ 421.00
- Resultado neto: S/ 4,066.80
- Pendientes migración: 8

Próximo paso recomendado:

1. Subir checkpoint a GitHub.
2. Luego trabajar permisos finos por rol: no solo ocultar botones/links, sino también bloquear rutas y acciones.
3. Después seguir con perfil de cliente o mejoras de Citas de hoy.

No iniciar panel WhatsApp todavía hasta consolidar Caja.
