# Caja Vita Lima

Sistema privado de caja, reservas, pagos y reportes para operación de Vita Lima Spa.

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

## Alcance inicial

La primera versión migrará progresivamente la Caja actual de Apps Script hacia una arquitectura más robusta:

- Next.js para la interfaz web.
- Supabase para base de datos.
- Vercel para publicación.
- n8n para automatizaciones.
- Google Calendar y WhatsApp Cloud API como integraciones externas.

La Caja actual en Apps Script se mantendrá activa como sistema operativo temporal hasta que la nueva versión esté validada.

---

## Módulos principales

La nueva Caja Vita Lima deberá contemplar los siguientes módulos:

- Citas de hoy
- Nueva atención
- Reserva futura
- Clientes
- Pagos
- Terapistas
- Gift Cards
- Cupones y convenios
- Boletas pendientes
- Salidas
- Cierre de caja
- Dashboard financiero
- Reportes exportables

---

## Arquitectura propuesta

```text
GitHub
└── Código fuente y documentación técnica

Supabase
└── Base de datos:
    ├── clientes
    ├── citas_reservadas
    ├── caja_movimientos
    ├── caja_pagos
    ├── caja_atencion_detalle
    ├── gift_cards
    ├── cupones_convenios
    ├── caja_salidas
    └── caja_cierres

Vercel
└── Publicación de la aplicación web

n8n
└── Automatizaciones con:
    ├── WhatsApp Cloud API
    ├── Google Calendar
    ├── recordatorios
    ├── reportes
    └── post venta
```

---

## Estado del proyecto

```text
Fase actual: planificación técnica y preparación de base de datos.
Apps Script actual: se mantiene como sistema operativo temporal.
Nueva app: pendiente de creación.
Supabase: pendiente de configuración.
Vercel: pendiente de configuración.
n8n: pendiente de integración con nueva base.
```

---

## Estructura esperada del repositorio

```text
docs/
  arquitectura.md
  migracion-apps-script.md
  roles-y-permisos.md

sql/
  001_create_tables.sql
  002_create_views.sql
  003_policies.sql

src/
  app/
  components/
  lib/
```

---

## Roles previstos

```text
ADMIN_GERALD
- Administra sistema, código, arquitectura, despliegue e integraciones.
- Acceso total técnico y operativo.

CAJA
- Registra atenciones, pagos, boletas, salidas y cierres.
- Acceso operativo diario.

FINANZAS
- Consulta dashboard financiero.
- Exporta reportes de ingresos, salidas, cierres y pagos por método.
- No accede al código fuente.

LECTURA
- Consulta información autorizada.
- Sin permisos de edición crítica.
```

---

## Tablas base previstas

```text
config_listas
usuarios
clientes
citas_reservadas
caja_movimientos
caja_pagos
caja_atencion_detalle
gift_cards
cupones_convenios
caja_salidas
caja_cierres
```

---

## Migración desde Apps Script

La migración será progresiva.

Primero se documentará la estructura actual de la Caja en Apps Script:

- Hojas usadas.
- Columnas principales.
- Funciones críticas.
- Flujo de atención.
- Flujo de reserva.
- Flujo de pagos.
- Flujo de cierre.
- Flujo de dashboard.

Luego se creará la base en Supabase y se importará una copia de los datos actuales.

La app nueva se construirá por módulos, empezando por:

1. Login
2. Citas de hoy
3. Atender cita
4. Nueva atención / reserva futura
5. Dashboard
6. Cierre de caja
7. Reportes exportables

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

