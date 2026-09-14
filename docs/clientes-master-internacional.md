# Clientes maestros e identidad telefónica internacional

`public.clientes` es la fuente maestra de clientes de Vita Lima. Una reserva,
una cita y un movimiento de caja son entidades operativas relacionadas, no una
fuente alternativa de identidad del cliente.

## Teléfono

- `whatsapp` conserva el valor operativo/original cuando el flujo lo dispone.
- `whatsapp_e164` es la llave canónica y única solo cuando el teléfono se
  normalizó con seguridad.
- `pais_telefono` es el ISO-2 del país declarado o determinado de forma segura.
- Un número local sin país no se convierte a `+51`: queda pendiente de revisión.
- `telefono_estado`, `telefono_normalizacion_origen` y
  `telefono_normalizado_en` hacen visible si la identidad es canónica o requiere
  revisión. Los datos anteriores a la migración permanecen sin clasificar hasta
  su revisión; no se certifican por una actualización incidental.

La aplicación debe usar `normalizarTelefonoE164()` como única normalización y
buscar por `whatsapp_e164` únicamente después de una normalización válida. Dos
formatos equivalentes se resuelven a una sola llave y el índice parcial único
impide que dos clientes canónicos compartan el teléfono.

## Históricos y Google Contacts

Los históricos se importarán en una fase posterior y deberán aportar país o
pasar por una cola de revisión. No se aceptará una regla de “nueve dígitos =
Perú”.

Google Contacts será una réplica operativa, nunca la fuente maestra. La futura
integración debe vivir en una tabla de mapeo separada (por ejemplo,
`cliente_contactos_google`) con `cliente_id`, `google_resource_name`, estado de
sincronización, última sincronización y versión/hash del payload. Se posterga
esa migración hasta definir consentimiento, resolución de conflictos y el
contrato de Google; no se almacenan credenciales en Caja.

Datos médicos o de salud no pertenecen a `clientes` ni se sincronizan a Google
Contacts.

## Lista Clientes de Caja

`vista_clientes_crm_catalogo_master_v1` parte exclusivamente de
`public.clientes`; movimientos y reservas se agregan con `LEFT JOIN`.

La interfaz conserva por ahora el contrato completo de
`vista_clientes_crm_catalogo`, cuya definición no está versionada: lee esa vista
y agrega solamente los maestros ausentes desde `public.clientes`. Así no se
degradan sus campos CRM/catálogo conocidos. El maestro añadido recibe solo datos
seguros: visitas/gasto en cero, fechas nulas y `SIN_ACTIVIDAD`; los campos de
catálogo desconocidos no se inventan.

Antes de aplicar la migración en staging hay que ejecutar las dos consultas
read-only incluidas para guardar `pg_get_viewdef(...)` y la lista ordenada de
columnas de la vista heredada. Recién con ese contrato se podrá decidir si la
vista maestra puede reemplazarla completamente.
