# Caja Vita Lima

Sistema privado de caja, reservas, pagos y reportes para operación de Vita Lima Spa.

**En producción** en `caja.vitalimaspa.com`. Última revisión de este documento: 2026-09-06.

---

## Objetivo

Construir una nueva versión profesional de Caja Vita Lima, separando claramente:

- Código fuente y arquitectura técnica.
- Base de datos operativa.
- Reportes financieros.
- Integraciones con n8n, WhatsApp y Google Calendar.

La finalidad es evolucionar la Caja actual hecha en Google Apps Script hacia una plataforma más robusta, ordenada, escalable y preparada para crecer como sistema interno de gestión.

---

## Modelo de propiedad y uso

Este repositorio contiene el código fuente, arquitectura técnica y documentación de implementación del sistema.

El sistema está diseñado para uso operativo de Vita Lima Spa.

Los datos generados por la operación de Vita Lima Spa, como ingresos, pagos, cierres, reservas, clientes, salidas y reportes financieros, podrán ser consultados, gestionados y exportados por los usuarios autorizados del negocio.

El código fuente, estructura técnica, despliegue, integraciones, automatizaciones y mantenimiento quedan bajo administración técnica de Gerald.

En resumen:

```text
Vita Lima Spa accede a sus datos operativos y financieros.
Gerald administra el sistema, código, arquitectura e implementación técnica.
```

---

## Stack actual

- Next.js 16 con React 19 para la interfaz.
- Supabase (PostgreSQL) para la base de datos, consultada por REST desde el servidor.
- Docker sobre Contabo para la publicación. **No se usa Vercel**: se evaluó al principio y
  se descartó, pero varios documentos antiguos del repo todavía lo mencionan.
- n8n para automatizaciones.
- Google Calendar y WhatsApp Cloud API como integraciones externas.

La Caja en Apps Script se mantiene como respaldo temporal.

---

## Módulos

| Módulo | Estado | Ruta |
|---|---|---|
| Dashboard financiero | ✅ en producción | `/` |
| Clientes | ✅ en producción | `/clientes` |
| Citas de hoy | ✅ en producción | `/citas-hoy` |
| Nueva atención | ✅ en producción | `/nueva-atencion` |
| Salidas | ✅ en producción | `/registrar-salida` |
| Comprobantes / boletas pendientes | ✅ en producción | `/comprobantes` |
| Cierre de caja | ✅ en producción | `/cierre-caja` |
| Reportes exportables | ⚠️ parcial — exportación del Dashboard a Excel | `/api/dashboard/export` |
| Reserva futura | ❌ pendiente | — |
| Pagos (módulo propio) | ❌ pendiente — hoy se registran dentro de "nueva atención" | — |
| Terapistas | ❌ pendiente — hoy son una lista en `config_listas` | — |
| Gift Cards | ❌ pendiente — la tabla `gift_cards` existe sin interfaz | — |
| Cupones y convenios | ❌ pendiente — la tabla `cupones_convenios` existe sin interfaz | — |

---

## Arquitectura real

```text
GitHub
└── Código fuente, SQL y documentación técnica

Supabase
└── Base de datos (14 tablas + ~37 vistas, definidas en sql/001 → sql/012)

Contabo
└── Publicación: contenedor Docker caja-vita-lima, servido por nginx
    en caja.vitalimaspa.com

n8n
└── Automatizaciones: WhatsApp Cloud API, Google Calendar,
    recordatorios, reportes, post venta
```

La topología exacta del servidor (contenedores, red, `--env-file`, secuencia de despliegue)
está en `docs/CHECKPOINT_AUDITORIA_2026_08_30.md` §4.

Cómo encaja esta Caja con la web pública y el bot de WhatsApp:
`vita-lima-bot-n8n/documentation/ARQUITECTURA_INTEGRACION_VITA_LIMA.md`.

---

## Estado del proyecto

```text
Fase actual:       operación. La app está en producción en caja.vitalimaspa.com.
Apps Script:       se mantiene como respaldo temporal.
Supabase:          configurado y en uso.
Publicación:       Docker en Contabo (no Vercel).
n8n:               integrado para el bot; sin puente con las tablas de esta Caja todavía.
Última auditoría:  2026-08-30 — ver docs/CHECKPOINT_AUDITORIA_2026_08_30.md
```

---

## Estructura del repositorio

```text
app/          Rutas y Server Actions (Next.js App Router)
components/   Componentes compartidos de UI
lib/          auth, env, cliente de Supabase, totales del dashboard
sql/          001 → 012, migraciones aplicadas en orden
docs/         Checkpoints, auditorías y documentos de migración
```

---

## Roles

Los que el código reconoce hoy (`lib/auth.ts`):

```text
ADMIN_GERALD
- Acceso total: dashboard, clientes, citas, atenciones, salidas,
  comprobantes, cierre de caja y alertas.

SOCIO
- Mismos módulos que ADMIN_GERALD.
- La distinción es de responsabilidad, no de permisos: hoy no se diferencian en el código.

VITA_OPERACION
- Citas de hoy, nueva atención, registrar salida y cierre de caja.
- Sin dashboard, clientes ni comprobantes.
```

> **Pendiente de conciliar:** el seed de `sql/001_create_tables.sql` todavía crea usuarios con
> los roles `CAJA` y `FINANZAS`, que el código no reconoce — un usuario creado así no puede
> iniciar sesión, porque el token queda inválido. Antes de corregir el seed hay que confirmar
> qué roles tiene realmente la tabla `usuarios` en producción.

---

## Tablas

```text
config_listas          usuarios               clientes
citas_reservadas       caja_movimientos       caja_pagos
caja_atencion_detalle  gift_cards             cupones_convenios
caja_salidas           caja_cierres           login_intentos
migracion_revision     migracion_correcciones
```

Dos tablas más se usan en producción **sin DDL versionado en `sql/`**, y por eso la base no
se puede reconstruir entera desde este repositorio:

- `stg_services_catalog_v5` — copia del catálogo de servicios del bot; la Caja la lee y
  también le escribe los servicios personalizados que se crean desde "nueva atención".
- `stg_promotions_v1` — copia de las promociones del bot.

---

## Migración desde Apps Script

La migración fue progresiva y ya está hecha en su mayor parte: la estructura de las hojas de
Apps Script se documentó, las tablas se crearon en Supabase y los datos reales se importaron
y revisaron. El detalle está en `docs/`:

- `migracion-caja-real.md` — cómo se transformó el Excel operativo real al modelo de Supabase.
- `revision-y-correccion-migracion.md` — qué se corrigió después de importar.
- `diagnostico-1semestre2026.md` — diagnóstico de la data del primer semestre.
- `CHECKPOINT_FASE_OPERATIVA_2026_07_07.md` — cierre de la fase operativa.

De los módulos previstos al inicio, siguen sin construirse la reserva futura, pagos como
módulo propio, terapistas, gift cards y cupones (ver la tabla de **Módulos**).

---

## Pendientes abiertos

De la auditoría del 2026-08-30 y de la revisión cruzada del 2026-09-06:

1. Mover los cuatro inserts de "nueva atención" a una función RPC de Postgres: hoy se
   ejecutan en secuencia y sin transacción, así que un fallo a media escritura deja la
   atención registrada a medias.
2. Versionar en `sql/` el DDL de `stg_services_catalog_v5` y `stg_promotions_v1`.
3. Conciliar los roles entre el seed de `sql/001`, este README y `lib/auth.ts`.
4. Los PIN de `usuarios` se guardan en texto plano y se comparan sin tiempo constante. El
   bloqueo por intentos fallidos (`sql/012`) mitiga la fuerza bruta, pero no el hecho de que
   cualquiera con lectura sobre la tabla ve todos los PIN.
5. Evaluar una columna de sede real en `migracion_revision`, hoy resuelta con `'SIN_SEDE'`.
6. Crear un `docker-compose.yml` en `/opt/caja-vita-lima` para no depender de `docker build`
   y `docker run` a mano en cada despliegue.
7. `CAJA_APP_PASSWORD` sigue en el `.env.production` del servidor sin que ningún código la
   lea; conviene retirarla del servidor.

---

## Principios del proyecto

- No romper la Caja actual mientras se construye la nueva.
- Mantener Apps Script como respaldo temporal.
- Separar código técnico de datos operativos.
- Permitir exportación financiera para usuarios autorizados.
- Evitar licencias públicas de uso.
- Mantener el repositorio privado.
- Documentar cada cambio importante.
- Construir primero la base de datos antes de diseñar pantallas avanzadas.

---

## Notas

Este repositorio es privado.

No contiene licencias públicas de uso.

El acceso al código fuente, estructura técnica, despliegue e integraciones queda bajo control técnico de Gerald.

Los reportes y datos operativos de Vita Lima Spa podrán ser consultados o exportados por los usuarios autorizados del negocio según su rol.

