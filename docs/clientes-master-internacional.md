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

`/clientes` y el detalle consultan
`vista_clientes_crm_catalogo_master_v1`. La vista parte exclusivamente de
`public.clientes`; movimientos y reservas se agregan con `LEFT JOIN`.
Por ello un cliente maestro recién importado, sin actividad moderna, aparece con
`total_visitas = 0`, `total_gastado = 0`, fechas de actividad nulas,
`estado_actividad_crm = SIN_ACTIVIDAD` y la segmentación propia que tenga en
`clientes`.

La vista anterior `vista_clientes_crm_catalogo` no tiene definición versionada
en el repositorio, por lo que no se reemplaza sin inspección en el entorno de
base de datos. La migración incluye una consulta de validación que demuestra que
ningún `cliente_id` maestro quedó excluido.
