# Arquitectura — Caja Vita Lima

## Objetivo técnico

Definir la arquitectura inicial de la nueva Caja Vita Lima, separando claramente código, base de datos, despliegue, automatizaciones y reportes.

---

## Arquitectura general

```text
GitHub
└── Código fuente, documentación y SQL del proyecto

Supabase
└── Base de datos central del sistema

Vercel
└── Publicación de la aplicación web

n8n
└── Automatizaciones externas

WhatsApp Cloud API
└── Canal de comunicación con clientes

Google Calendar
└── Agenda operativa por sede
```

---

## Componentes principales

### 1. GitHub

Repositorio privado donde se guardará:

- Código fuente de la app.
- Documentación técnica.
- Scripts SQL.
- Historial de cambios.
- Plan de migración desde Apps Script.

El repositorio queda bajo control técnico de Gerald.

---

### 2. Supabase

Supabase será la base de datos principal de la nueva Caja.

Reemplazará progresivamente el uso de Google Sheets como base operativa.

Tablas iniciales previstas:

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

### 3. Vercel

Vercel publicará la app web creada en Next.js.

La aplicación permitirá acceso por roles:

- ADMIN_GERALD
- CAJA
- FINANZAS
- LECTURA

---

### 4. n8n

n8n seguirá siendo el motor de automatización para:

- WhatsApp.
- Recordatorios.
- Post venta.
- Reportes.
- Integración con Google Calendar.
- Futuras conexiones con Supabase.

---

## Flujo operativo esperado

```text
Cliente reserva por WhatsApp
        ↓
n8n procesa la conversación
        ↓
Supabase guarda cliente / reserva / pago
        ↓
Caja Vita Lima muestra cita en panel
        ↓
Caja registra atención y pago final
        ↓
Supabase actualiza movimientos, pagos y cierre
        ↓
Dashboard muestra ingresos y reportes
```

---

## Flujo de reportes

```text
Usuario FINANZAS selecciona periodo
        ↓
Sistema consulta Supabase
        ↓
Genera reporte de ingresos / salidas / pagos
        ↓
Usuario puede exportar CSV, Excel o PDF
        ↓
Opcionalmente se envía al correo de Vita Lima
```

---

## Principios técnicos

- No tocar producción actual hasta tener versión nueva validada.
- Apps Script se mantiene como respaldo temporal.
- Supabase será primero una copia ordenada de la data.
- La app nueva se construirá por módulos.
- El código técnico no se mezcla con reportes operativos.
- Los usuarios del negocio acceden solo según su rol.
- La data de Vita Lima debe ser exportable por usuarios autorizados.
