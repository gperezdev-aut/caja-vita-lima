# CHECKPOINT — Caja Vita Lima
## 14/09/2026 — cierre de Gift Cards + PR #37 en curso

### 1. Estado general

Repositorio principal:
- `gperezdev-aut/caja-vita-lima`

Producción:
- Caja desplegada en Contabo.
- Contenedor `caja-vita-lima` quedó `running` y `healthy`.
- Imagen desplegada durante el cierre de Gift Cards:
  - `caja-vita-lima:local`
  - image id observado: `sha256:506bd499cf7a51469df39a5d8a40de1cf8814c3dcd48524ba6d3be0da40af0ba`
- Se dejó una imagen de rollback:
  - `caja-vita-lima:rollback-pre-giftcards`

NO tocar producción mientras el PR #37 siga en desarrollo.

### 2. Gift Cards — CERRADO Y EN PRODUCCIÓN

PRs relevantes ya trabajados:
- #28 plantilla real
- #29 UX final + entrega PNG
- #31 fuentes Docker/Resvg
- #32 Node 20 + `tsx`
- #34 composición PNG final

Estado final:
- PNG correcto en producción.
- `included_es` visible.
- Beneficiario, servicio, duración y dedicatoria con mejor jerarquía.
- Auto-fit por ancho real aproximado de glifos.
- Sin overflow en región segura.
- Tildes, ñ y emoji renderizan correctamente.
- “Ver Gift Card” y “Descargar Gift Card” usan el mismo PNG.
- Gift Card por monto omite servicio, descripción y duración.
- Gift Card por servicio usa snapshot histórico exacto.
- Dedicatoria larga validada visualmente.
- Gift Card por monto validada visualmente.
- QA productivo aprobado.

Veredicto:
- Gift Cards visuales: APROBADO.
- No seguir ajustando diseño salvo bug nuevo real.

### 3. SQL ya aplicado y validado

Migración 026:
- RPC histórica de catálogo para Gift Cards.
- `service_role` puede ejecutar la RPC.
- `service_role` NO tiene SELECT directo sobre `caja_catalog_services`.
- resolución histórica validada con match exacto:
  - `service_code`
  - `release_id`
  - `price_version`

Migración 027:
- aplicada manualmente en Supabase.
- corrige vistas de ledger usando lógica null-safe.
- validación posterior:
  - `total_vista_fecha = 44175.10`
  - `total_vista_mes = 44175.10`
  - `total_pagos = 44175.10`
  - `vista_027_activa = true`

Antes de aplicarla también se confirmó:
- `total_movimientos = 44175.10`
- `total_pagos = 44175.10`
- diferencia = `0.00`
- sin diferencias por fecha/sede.

Veredicto:
- SQL 026 y 027: OK en remoto.

### 4. CI SQL global — PR #35

Se corrigió el workflow PostgreSQL para usar bases temporales aisladas.

También apareció y se corrigió el problema de vistas/joins del ledger que terminó versionado en 027.

Estado:
- PR #35 fue utilizado para corregir el CI.
- No volver a mezclar esa deuda con PRs funcionales.

### 5. Siguiente módulo grande — Gift Card → Reserva → Ficha → Atención → Canje

Flujo de negocio acordado:

1. El beneficiario escribe al WhatsApp de Vita Lima.
2. El operador que atiende WhatsApp busca/abre la Gift Card en Caja.
3. Pulsa “Preparar cita con esta Gift Card”.
4. Caja precarga beneficiario y WhatsApp si existe.
5. El operador acuerda sede, fecha y hora.
6. Caja crea la reserva y genera la ficha existente.
7. El operador envía el enlace con “Abrir WhatsApp”.
8. El beneficiario completa la ficha en la Web pública: `/cita/[token]`.
9. La Gift Card NO se canjea al reservar.
10. Se crea un hold/reserva de saldo auditable.
11. Al concretarse la atención, el hold se convierte en canje.
12. Si la cita se libera/cancela antes de atenderse, el hold vuelve a quedar disponible.

Regla contable clave:
- la venta de Gift Card ya fue ingreso.
- el canje NO debe crear un nuevo `caja_pago` por el valor consumido.
- cualquier diferencia pagada realmente por el cliente sí entra a `caja_pagos`.

### 6. Arquitectura acordada para PR #37

Nueva entidad:
- `gift_card_reservas`

Estados del hold:
- `ACTIVA`
- `LIBERADA`
- `CANJEADA`

No usar el estado principal de Gift Card para representar “reservada”.

Saldo:
- saldo financiero = monto Gift Card - usos reales
- saldo comprometido = suma holds ACTIVOS
- saldo disponible = saldo financiero - saldo comprometido

Gift Card SERVICIO:
- servicio histórico exacto
- no usar precio actual para invalidar el derecho comprado
- usar snapshot histórico persistido
- una reserva activa por servicio
- canje completo al concretarse atención

Gift Card MONTO:
- permite seleccionar servicio dentro del alcance MVP
- cobertura = `min(saldo_disponible, total_cita)`
- puede quedar saldo para usos futuros
- si falta dinero, solo la diferencia real se cobra

MVP:
- sede solamente
- sin domicilio
- sin promoción
- sin atención personalizada

### 7. PR #37 — ESTADO ACTUAL REAL

PR:
- `#37`
- título: `feat: preparar citas y canjear Gift Cards`
- rama: `feat/gift-card-reserva-ficha`
- base: `main`
- estado: ABIERTO
- mergeado: NO
- draft: NO
- mergeable: SÍ
- archivos cambiados: 28
- commits: 4
- aproximadamente `+545 / -85`

HEAD observado:
- `3128b1eeae1fb96d44929df4fbc724ea107a69cf`

El cuerpo del PR declara:
- holds auditables `gift_card_reservas`
- integración Gift Card servicio/monto con Preparar cita
- liberación de holds
- conversión atómica en canje
- `caja_pagos` solo para dinero real
- migración/contrato 028
- CI PostgreSQL aislado

No se ha:
- mergeado
- desplegado
- ejecutado SQL remoto
- modificado Supabase remoto
- tocado CRM/n8n
- tocado `vita-lima-web`

### 8. CI DEL PR #37 — NO ESTÁ VERDE TODAVÍA

Workflow:
- `Validate SQL contracts PostgreSQL`

Run observado:
- `34918007286`
- conclusión: FAILURE

Pasaron:
- Create isolated contract databases ✅
- Validate catalog snapshot contract ✅
- Validate payment ledger contract ✅
- Validate reservation-to-attention contract ✅

Falló:
- `Validate Gift Card reservation contract` ❌

Por lo tanto:
- NO considerar PR #37 terminado.
- NO mergear.
- NO desplegar.
- NO ejecutar migración 028 en Supabase todavía.

Codex estaba corrigiendo este contrato cuando se hizo el checkpoint.

### 9. Lo que mostró Codex antes del checkpoint

Codex ya:
- creó el PR #37
- corrigió al menos un fixture de catálogo
- cambió el servicio canónico usado por el fixture a `SVC_016`
- volvió a ejecutar CI
- el runner avanzó más allá del problema inicial de catálogo
- quedó investigando una aserción posterior del contrato 028

Importante:
- el fallo actual ya está concentrado en el contrato Gift Card reservation.
- los otros contratos PostgreSQL pasan.

### 10. Qué hacer al retomar

PRIORIDAD 1:
Esperar que Codex termine la corrección del PR #37.

Cuando responda:
1. recibir reporte final completo
2. verificar nuevo commit SHA
3. verificar que `Validate SQL contracts PostgreSQL` quede GREEN
4. revisar diff del PR #37
5. auditar especialmente:
   - migración `028_gift_card_reserva_ficha.sql`
   - RPC de preparar cita con Gift Card
   - hold ACTIVA/LIBERADA/CANJEADA
   - idempotencia
   - concurrencia
   - no duplicación de `caja_pagos`
   - integración con `iniciar_o_cerrar_atencion_reservada_v1`
   - bloqueo de canje manual cuando existe hold
   - liberación segura
6. NO aplicar SQL todavía

PRIORIDAD 2:
Si PR #37 queda técnicamente bien:
- pre-checks de solo lectura en Supabase
- validar objetos/tablas/RPC existentes
- validar compatibilidad con 023–027
- aplicar 028 manualmente solo después de aprobación
- ejecutar post-checks
- desplegar en QA aislado antes de producción

PRIORIDAD 3:
QA funcional:
- abrir Gift Card emitida
- “Preparar cita con esta Gift Card”
- SERVICIO bloqueado al histórico
- MONTO elige servicio
- cobertura/adelanto correctos
- generar ficha
- abrir WhatsApp
- completar ficha en Web
- ver cita en Citas de hoy
- iniciar/completar atención
- verificar canje
- verificar que NO se duplique ingreso
- verificar liberación de hold

### 11. Web pública

La Web ya tiene:
- `/cita/[token]`
- consumo server-to-server de la ficha desde Caja
- runtime Node
- `force-dynamic`
- `no-store`
- no indexación

En principio PR #37 NO debería requerir modificar la Web.
La ficha existente debe seguir reutilizándose.

### 12. Regla para no perder contexto

Al volver en otro chat:

> “Continuemos desde el checkpoint `CHECKPOINT_CAJA_VITA_LIMA_2026-09-14_PR37.md`. Antes de tocar código, revisa el estado actual del PR #37 y sus checks. No mergees, no despliegues ni ejecutes SQL remoto hasta que auditemos el PR y la migración 028.”

### 13. Estado de cierre

CERRADO:
- Gift Cards visuales
- PNG
- included_es
- QA Resvg
- producción Gift Cards
- SQL 026
- SQL 027
- CI SQL previo

EN CURSO:
- PR #37 Gift Card → reserva → ficha → atención → canje

BLOQUEADOR ACTUAL:
- contrato PostgreSQL 028 / Gift Card reservation todavía falla en GitHub Actions.

SIGUIENTE HITO:
- dejar PR #37 completamente verde y auditarlo antes de tocar Supabase.
