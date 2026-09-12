# Auditoría funcional Caja Vita Lima — integración y UX

Fecha: 2026-09-12  
Base auditada: `4bbbee3`  
Rama: `audit/caja-integracion-ux-final`

## Veredicto

`Preparar cita → Citas de hoy` ya comparte `caja_movimientos` y no debe
reimplementarse. En cambio, el sistema todavía no tiene un contrato transaccional
para convertir una reserva en atención y atribuye el adelanto de una cita futura a
la fecha de la cita. Ambos problemas bloquean habilitar **Iniciar atención** y
considerar los cierres/reportes como flujo de caja real. Requieren SQL y no se
modifican en este trabajo.

## Mapa de módulos y datos

| Módulo | Lee | Escribe | Claves | Alimentado por | Consumido por |
|---|---|---|---|---|---|
| Dashboard `/` | `vista_reporte_socio_resumen_con_alertas_v3`, `vista_reporte_socio_mensual`, `vista_reporte_socio_mes_actual`, `vista_comprobantes_control_resumen`, `vista_salidas_sin_fecha_resumen` | — | mes, sede | movimientos, salidas, cupones, revisión y comprobantes | socios y exportación |
| Export dashboard | vistas anteriores, `caja_movimientos`, `caja_salidas` | — | movimiento_id, salida_id | caja | XLSX |
| Clientes | `config_listas`, `vista_clientes_crm_catalogo`, `vista_servicios_crm_catalogo` | — | cliente_id, whatsapp | clientes, movimientos y catálogo | detalle CRM |
| Detalle cliente | `vista_clientes_crm_catalogo`, `vista_cliente_historial_crm` | `clientes` (PATCH) | cliente_id | Clientes/Preparar/Nueva atención | CRM, citas, comprobantes |
| Citas de hoy | `config_listas`, `caja_movimientos`, `caja_atencion_detalle`, `vista_clientes_crm_catalogo` | — | movimiento_id, cliente/whatsapp | Preparar cita y Nueva atención | operación, cierre, comprobantes |
| Preparar cita | RPC de catálogo local, `sedes`, `config_listas`, `clientes` | por RPC: `clientes`, `caja_movimientos`, `citas_reservadas`, `caja_pagos`, `caja_atencion_detalle` | request_id, cliente_id, movimiento_id, reserva_id, pago_id | catálogo canónico local | Citas de hoy, ficha pública, CRM, reportes |
| Nueva atención | `config_listas`, `stg_services_catalog_v5`, `stg_promotions_v1`, `clientes` | `clientes`, `caja_movimientos`, `citas_reservadas`, `caja_pagos`, `caja_atencion_detalle`; opcionalmente staging | cliente_id, movimiento_id, reserva_id, pago_id | alta independiente | Citas, CRM, comprobantes, cierre/dashboard |
| Registrar salida | `config_listas`, `caja_salidas` | `caja_salidas` | salida_id, source_movimiento_id opcional | operación | cierre/dashboard |
| Comprobantes | `caja_movimientos` | `caja_movimientos` (PATCH) | movimiento_id | movimientos y ficha pública | dashboard/control fiscal |
| Cierre de caja | `config_listas`, `caja_movimientos`, `caja_salidas`, `caja_cierres` | `caja_cierres` | cierre_id; movimiento_id solo para sumar | operación diaria | histórico de cierres |
| Ficha pública | `citas_reservadas`, `clientes`, historial, salud y comprobantes | por RPC: cliente, ficha, movimiento, salud, solicitud de comprobante/convenio | token, reserva_id, cliente_id | Preparar cita | CRM y comprobantes |

No hay claves foráneas declaradas entre las tablas operativas iniciales. La
integridad se mantiene por IDs de texto, RPCs y convenciones `source_id`; eso
aumenta el riesgo de huérfanos en escrituras app-side secuenciales.

## Contrato 1 — Preparar cita → Citas de hoy

Confirmado por código:

- `preparar_ficha_cita` y `preparar_atencion_personalizada` insertan exactamente
  un `caja_movimientos` con `fecha = fecha_cita`, `source_id = reserva_id`, estado
  reservado y el mismo cliente, sede, servicio, total, pagado y pendiente.
- También insertan `citas_reservadas`, `caja_pagos` y detalle con terapista
  `Por asignar`; `request_id` único evita repetir la preparación.
- `/citas-hoy?fecha=X` lee directamente `caja_movimientos` con `fecha=eq.X` y
  une el detalle en memoria por `movimiento_id`. Por ello cubre 1P, paquete 2P,
  HOME, monto recibido real, saldo, sede, servicio, terapista, estado y
  comprobante sin tabla paralela.
- El total real recibido se conserva como `v_pagado`; el mínimo solo valida el
  umbral. Ejemplo: total 229, mínimo 114.50, recibido 115 produce saldo 114.

Riesgo: Citas de hoy mezcla reservas y atenciones porque ambas viven en la misma
tabla y no ofrece una transición segura de estado.

## Contrato 2 — Citas de hoy → Iniciar atención (BLOQUEANTE SQL)

Nueva atención es hoy un alta independiente. Siempre crea nuevos
`movimiento_id` y `reserva_id`; enviarla con datos de una cita existente produciría
dos movimientos para la misma atención. No se añadió un botón decorativo.

Mutación transaccional requerida antes de habilitar la acción:

1. RPC server-only recibe `movimiento_id`, `reserva_id`, terapistas, extras
   validados, pago restante, método, operación, comprobante y responsable.
2. Bloquea con `FOR UPDATE` la reserva y el movimiento; exige relación
   `citas_reservadas.source_id = caja_movimientos.movimiento_id` y
   `caja_movimientos.source_id = citas_reservadas.reserva_id`.
3. Reutiliza sin cambiar `cliente_id`, `movimiento_id`, `reserva_id`, WhatsApp,
   sede, servicio, total base, adelanto previo, ficha y observaciones.
4. Actualiza el movimiento existente: `tipo_movimiento = ATENCION_APP`, estado
   final acordado, `total_extras`, `total_cobrar`, `total_pagado` como suma real
   de pagos y `pendiente = total_cobrar - total_pagado`.
5. Actualiza detalles existentes por `movimiento_id/persona_n` con terapista; los
   extras deben ser líneas identificables, no otro movimiento.
6. Inserta solo el pago restante en `caja_pagos`, con fecha/hora real de cobro y
   un `pago_id` idempotente; no reescribe el adelanto.
7. Actualiza la misma reserva (`estado`, `saldo_pendiente`) y los campos de
   comprobante del mismo movimiento.
8. Reintentos deben devolver el mismo resultado o rechazar payload diferente.

Decisiones humanas necesarias: nombres canónicos de estados final/cancelado/no
show, política de extras, si una atención puede cerrarse con saldo y quién puede
reabrirla. Sin esa RPC, una secuencia de PATCH/INSERT desde Next.js puede quedar a
medias y no es segura.

## Contrato 3 — Nueva atención y catálogo (BLOQUEANTE de diseño + SQL)

El módulo lee `stg_services_catalog_v5` y `stg_promotions_v1`, confía en precio y
duración enviados por el navegador y un administrador puede insertar un servicio
personalizado en staging. Preparar cita ya usa las RPC privadas del snapshot
canónico local y valida economía en servidor/SQL.

Plan de migración exacto:

1. Reutilizar `leerCatalogoPrepararCita()` para lectura local y mapear
   `serviceCode`, nombre, duración, precio, `paxType`, HOME y versión.
2. Resolver promociones solo si el snapshot canónico define expresamente su
   representación; no traducir ni inventar promociones legacy.
3. Hacer que la acción envíe códigos, no importes confiados, y que una RPC
   transaccional recalcule precio/duración contra el snapshot activo.
4. Mantener el lector legacy aislado mientras otros flujos dependan de staging.
5. Quitar de Nueva atención la escritura “guardar en catálogo”; un servicio
   manual debe quedar solo como detalle auditado de esa atención. Publicarlo en
   catálogo requiere el flujo administrativo canónico.
6. Ejecutar esta migración junto con el contrato de iniciar reserva para evitar
   construir dos caminos de escritura incompatibles.

## Contratos 4 y 5 — fechas de pago, totales y saldos (BLOQUEANTE SQL)

Comportamiento actual para pago 12/09 y cita 20/09:

| Dato | Valor actual |
|---|---|
| `citas_reservadas.fecha_cita` | 20/09 (correcto) |
| `caja_movimientos.fecha` | 20/09 (fecha operativa de cita) |
| `caja_pagos.fecha` | 20/09 (**incorrecto para caja**) |
| Citas de hoy | aparece el 20/09 |
| Cierre | suma `caja_movimientos.total_pagado` el 20/09 |
| Dashboard | agrupa `caja_movimientos.total_pagado` en septiembre/fecha de cita |

La RPC usa `v_fecha` para las tres tablas. Además, cierre y dashboard suman el
acumulado del movimiento, no el ledger `caja_pagos`: un adelanto y un pago final
en días distintos no pueden asignarse correctamente y pueden volver a contarse
como un único total en la fecha de atención.

Corrección mínima requerida: conservar `movimiento.fecha` como fecha de cita;
calcular en la RPC `fecha/hora` de pago desde `now()` en `America/Lima`; migrar
los cierres y vistas de ingresos a `sum(caja_pagos.monto)` por `caja_pagos.fecha`
y sede; reconciliar `movimiento.total_pagado` contra la suma de pagos. El backfill
histórico necesita decisión humana porque `created_at` puede ser la única señal
de fecha real y no siempre prueba cuándo se recibió el dinero.

## Contrato 6 — cliente único

Preparar cita busca `clientes.whatsapp_e164`, protegido por índice único, y la
RPC reutiliza `cliente_id`; es el flujo correcto. Nueva atención busca solo
`clientes.whatsapp` con exactamente nueve dígitos y puede duplicar clientes
internacionales o registros donde `whatsapp` y `whatsapp_e164` divergen. El editor
CRM modifica `whatsapp` pero no `whatsapp_e164`, otra fuente de divergencia.

La migración de Nueva atención debe buscar exclusivamente el E.164 normalizado.
Antes de sincronizar manualmente columnas existentes hace falta resolver los
duplicados que puedan chocar con `uq_clientes_whatsapp_e164`.

## Contrato 7 — WhatsApp internacional

Existían cuatro copias de `waHref` que recortaban a nueve dígitos y añadían +51,
corrompiendo +1 y +52. Se reemplazan por una utilidad compartida que conserva
E.164 válido, admite el formato peruano legacy y rechaza valores vacíos/inválidos.

## Contrato 8 — comprobantes

La unidad editable es `caja_movimientos.movimiento_id`; guarda tipo, estado,
número, fecha de emisión, revisor, timestamp y observación. La ficha pública crea
una solicitud única por `reserva_id` y sincroniza los campos legacy del movimiento.
Riesgos: no hay validación cruzada (por ejemplo, `OK` sin número/fecha) en la
acción; `estado_boleta`/`numero_boleta` legacy y los campos nuevos pueden divergir;
la solicitud y el movimiento no comparten FK. La transición a atención debe
reutilizar el mismo movimiento para no duplicar el comprobante.

## Contrato 9 — cierre de caja (BLOQUEANTE SQL)

“Total ingresos” representa actualmente la suma de `total_pagado` de movimientos
cuya **fecha de cita** coincide con el cierre. No representa necesariamente dinero
recibido ese día. Tampoco desglosa efectivo, Yape, Plin, Izipay u otros métodos,
aunque `caja_pagos.metodo` sí los conserva. Reservas futuras quedan desplazadas a
la fecha futura y pagos en fechas diferentes quedan acumulados en el movimiento.

Después de corregir el ledger de pagos, cierre debe sumar `caja_pagos` por fecha y
sede, mostrar desglose por método, separar cálculo automático de caja física
(solo efectivo) y bloquear/advertir cierres duplicados por fecha+sede según una
decisión de negocio. No se cambian fórmulas sin esa base y sus pruebas SQL.

## Contrato 10 — dashboard (BLOQUEANTE SQL)

Las vistas financieras agrupan `caja_movimientos.total_pagado` por
`caja_movimientos.fecha`. Incluyen reservas como otros ingresos y no distinguen
adelantos/pagos finales por fecha real. Las vistas de CRM también cuentan
movimientos; una reserva duplicada luego como atención infla visitas, gasto y
servicios. La corrección debe partir del ledger de pagos y de una única identidad
movimiento/reserva-atención, y definir métricas separadas para reservas,
atenciones, adelantos, saldos y salidas.

## Riesgos consolidados

- **Duplicación:** Nueva atención hace cuatro escrituras secuenciales, sin RPC ni
  rollback, y crea IDs nuevos incluso para una reserva existente.
- **Financiero:** fecha de cobro equivocada; cierre/dashboard basados en acumulado
  por cita; falta conciliación pagos↔movimiento; cierres duplicables y totales
  automáticos editables sin evidencia del valor calculado.
- **Seguridad:** `service_role` permanece server-only y todos los módulos/actions
  revisados conservan `requireModuleAccess`. Riesgos restantes: PIN guardado y
  comparado en texto plano; compatibilidad de cookie antigua que acepta el secreto
  plano; detalles crudos de errores Supabase pueden llegar a la UI; PATCH directo
  sin esquema central de validación. No se encontró PII en localStorage.
- **UX:** acciones fragmentadas, tablas anchas, estados legacy ambiguos, cliente
  internacional inconsistente y ausencia deliberada de “Iniciar atención” hasta
  que sea funcionalmente seguro.

## Mejoras UX y app-side realizadas

- WhatsApp internacional compartido en Citas de hoy, Clientes, detalle de
  cliente y Comprobantes; los valores inválidos ya no generan enlaces rotos.
- Citas de hoy muestra acciones móviles reales para WhatsApp y ficha del cliente,
  además de cliente, servicio, sede, terapista, total, pagado, saldo, estado y
  comprobante. No se añadió la acción bloqueada de iniciar atención.
- La base de Clientes cambia de tabla ancha a cards operativas en móvil, con
  nombre, servicio frecuente, última visita, sede, estado, visitas, gasto y
  accesos de una mano.
- Controles móviles con 48 px de alto, tipografía de 16 px en inputs, enlaces con
  foco visible, paneles compactos y tablas restantes con scroll horizontal
  contenido.
- Cierre distingue en texto los ingresos atribuidos a fecha operativa, marca los
  importes automáticos como sugeridos/editables y advierte que aún no representan
  el ledger diario hasta completar la migración bloqueada.
- Dashboard deja de llamar “confirmados” a esos ingresos y los identifica como
  ingresos por fecha operativa.
- Comprobantes valida enums, exige número y fecha para `OK`, exige coherencia
  bilateral para `NO_APLICA` y registra como revisor al usuario autenticado.

## Mejoras UX pendientes

- Iniciar atención desde una cita y completar terapista, saldo, extras y
  comprobante; depende de la RPC transaccional.
- Nueva atención sobre catálogo canónico y teléfono internacional; depende del
  plan de migración funcional descrito.
- Desglose de cierre por efectivo/Yape/Plin/Izipay y caja esperada basada en
  cobros reales; depende del ledger con fecha corregida.
- Métricas separadas de reservas, atenciones, adelantos y pagos finales en
  Dashboard; dependen de vistas SQL nuevas.
- Cards móviles especializadas para cada tabla histórica secundaria; hoy se
  conserva scroll controlado para no duplicar lógica de negocio.

## Bloqueantes exactos

1. SQL: fecha/hora real en `caja_pagos` para ambas RPC de preparación.
2. SQL: RPC atómica e idempotente de reserva→atención.
3. Decisión: estados, extras, saldo al cierre y reapertura de atención.
4. SQL: dashboard y cierre basados en ledger de pagos; conciliación histórica.
5. Decisión/SQL: backfill de fechas reales de adelantos históricos.
6. SQL/datos: reconciliar duplicados `whatsapp`/`whatsapp_e164` antes de migrar
   Nueva atención.
7. Decisión de catálogo: representación canónica de promociones y publicación de
   servicios personalizados.
8. Decisión/SQL: unicidad y reapertura de cierre por fecha+sede.
9. Seguridad/decisión: migrar PIN a hash y retirar cookie legacy.

## Límites respetados

- Supabase remoto: **NO**
- Producción: **NO**
- Contabo: **NO**
- Web pública: **SIN CAMBIOS**
- CRM/n8n: **SIN CAMBIOS**
- Merge: **NO**

## Validación local

- `npm.cmd test`: 168/168 aprobados.
- `npm.cmd run typecheck`: aprobado.
- `npm.cmd run lint`: aprobado sin errores; conserva 38 advertencias legacy de
  `no-explicit-any` en páginas y utilidades existentes.
- `npm.cmd run build`: aprobado con Next.js 16.2.11.
- `git diff --check`: aprobado; solo avisos informativos de normalización LF/CRLF.
- QA responsive: reglas verificadas para 360 px, 390 px y desktop; tablas
  secundarias conservan scroll controlado y la base principal de Clientes usa
  cards bajo 600 px.
