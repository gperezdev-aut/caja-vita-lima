# Checkpoint — Catálogo canónico y Preparar cita

Fecha de corte: 2026-09-11 (Lima)
Repositorio: `gperezdev-aut/caja-vita-lima`

## Estado ejecutivo

La integración del catálogo canónico con Caja quedó operativa a nivel de datos y servidor, y la fase 3B.1-A de `Preparar cita` quedó mergeada en `main`.

Estado actual:

- Catálogo canónico publicado en STAGING: `catalog-v1-web-4104385`.
- Servicios canónicos: 50.
- Reglas HOME: 6.
- Snapshot local de Caja sincronizado e idempotente.
- Diagnóstico final del snapshot: `in_sync=true`.
- SQL `020_preparar_cita_catalogo_canonico.sql` aplicado en Supabase Caja.
- Harness 020 ejecutado correctamente con `ROLLBACK`.
- Validación final de permisos y eliminación de dependencias legacy: PASS.
- PR #18 mergeado en `main`.
- Commit de `main`: `80b8cf3 feat: preparar citas con catálogo canónico local (#18)`.
- Producción/Contabo todavía no fue redeployada con esta versión; la web pública de Caja aún mostraba 26 servicios al momento de este checkpoint.

## 1. Fase 3B.0-B — Snapshot canónico en Caja

Cerrada.

### Release activo

- Release: `catalog-v1-web-4104385`
- Servicios: 50
- HOME rules: 6
- HOME policy SHA256: `c94adc0adb80f56af291221a4363a4ddcd319790af73b64e2c9a42f69dee9bf1`

### Sincronización

Primera sincronización real:

- `release=catalog-v1-web-4104385`
- `services=50`
- `home_rules=6`
- `status=SYNCED`

Segunda sincronización:

- PASS
- idempotencia: PASS
- fingerprint sin cambios

Diagnóstico final:

- `remote_release=catalog-v1-web-4104385`
- `remote_services=50`
- `local_active_release=catalog-v1-web-4104385`
- `local_services=50`
- `local_home_rules=6`
- `in_sync=true`
- `PHASE_3B0B_DIAGNOSTIC=PASS`

## 2. Fase 3B.1-A — Preparar cita canónico

Cerrada y mergeada.

### Git

PR: #18 — `feat: preparar citas con catálogo canónico local`

Commit mergeado:

`80b8cf3 feat: preparar citas con catálogo canónico local (#18)`

### Dependencia legacy eliminada de Preparar cita

`Preparar cita` ya no debe depender de:

- `stg_services_catalog_v5`
- códigos `DOM-1H` / `DOM-2H`
- movilidad fija S/15

Las constantes legacy pueden permanecer para módulos antiguos, pero no son parte del flujo nuevo de Preparar cita.

### Lectura local canónica

Se crearon fronteras privadas server-side para leer el snapshot activo:

- `public.caja_catalog_active_services_read_v1()`
- `public.caja_catalog_home_policy_read_v1()`
- `public.caja_catalog_resolve_appointment_v1(...)`

Seguridad validada:

- `service_role`: EXECUTE = true
- `anon`: EXECUTE = false
- `authenticated`: EXECUTE = false

### Validación final remota

Resultado:

- services = 50
- home_rules = 6
- service_role_services = true
- anon_services = false
- authenticated_services = false
- no_staging_legacy = true
- no_dom_1h = true
- no_dom_2h = true

## 3. Contrato funcional de servicios

### ONE_PERSON

Servicio individual para una persona.

### FIXED_TWO_PACKAGE

Se trata como una sola selección para dos personas. No debe convertirse artificialmente en dos servicios individuales.

### HOME_FLOW

Flujo de atención a domicilio. Se reconoce por atributos canónicos (`category/modality`) y no por códigos legacy.

### PROGRAM_PURCHASE

No forma parte de citas normales de `Preparar cita`.

### Atención personalizada

Puede usar componentes de catálogo elegibles, pero los servicios de catálogo deben resolverse nuevamente server-side antes de persistir.

## 4. Política HOME vigente

El cargo HOME es por cita, no por persona ni por servicio.

- Miraflores → INCLUDED → S/0
- San Borja → FIXED → S/30
- Surco → FIXED → S/30
- San Isidro → FIXED → S/30
- Barranco → FIXED → S/30
- DEFAULT → MANUAL_CONFIRMATION

Si el distrito no está configurado:

- mostrar “Por confirmar”;
- no inventar S/0;
- bloquear el guardado hasta resolver la tarifa conforme a la lógica vigente.

## 5. Adelanto mínimo vs. monto realmente recibido

Regla confirmada:

El sistema debe separar:

1. adelanto mínimo/requerido calculado;
2. monto recibido real editable.

Ejemplo:

- adelanto mínimo: S/64.50
- cliente transfirió: S/65.00

La ficha debe persistir S/65.00 como pago real y calcular el saldo con S/65.00. No debe redondear el monto recibido al mínimo.

## 6. SQL 020

Archivo:

`sql/020_preparar_cita_catalogo_canonico.sql`

Aplicado manualmente en Supabase Caja con resultado:

`Success. No rows returned`

El SQL quedó con definiciones explícitas de:

- `public.preparar_ficha_cita(jsonb)`
- `public.preparar_atencion_personalizada(jsonb)`

Se descartó el enfoque frágil basado en `pg_get_functiondef + replace + execute`.

Harness:

`sql/tests/020_preparar_cita_catalogo_canonico_rollback.sql`

El harness se corrigió para capturar SQLSTATE `22023` en el caso HOME manual y luego pasó correctamente con `ROLLBACK`.

## 7. Estado de producción

Importante: el código nuevo ya está en GitHub `main` y el SQL ya está aplicado en Supabase Caja, pero Contabo todavía no fue redeployado con el nuevo `main` en el momento de este checkpoint.

La página pública `caja.vitalimaspa.com/preparar-cita` todavía mostraba el diseño anterior y “Servicios activos 26”.

Por decisión de producto, se pospone el redeploy hasta terminar la fase UX móvil para evitar desplegar dos veces.

## 8. Fase 3B.1-B — UX móvil de Preparar cita

Estado: en desarrollo.

Branch solicitado:

`feat/preparar-cita-ux-mobile`

Objetivo: convertir `Preparar cita` en un wizard progresivo mobile-first para la persona que atiende WhatsApp.

### Flujo deseado

1. Cliente
2. Tipo de cita / personas
3. Servicio
4. Lugar, fecha y hora
5. Pago
6. Confirmación

### Principios UX acordados

- No mostrar todo el formulario a la vez.
- Solo un paso visible por vez.
- Barra de progreso.
- Pasos completados editables.
- Sidebar oculto/colapsado en móvil.
- Buscador y tarjetas de servicios, no un select gigante como interfaz principal.
- Botones grandes para 1 persona / 2 personas / domicilio / personalizada.
- Para 2 personas, priorizar paquetes `FIXED_TWO_PACKAGE`; permitir alternativamente un servicio por persona.
- Campos condicionales: sede para presencial; distrito/dirección para HOME.
- Horarios como botones táctiles grandes.
- Resumen sticky inferior.
- Total, adelanto mínimo, monto recibido y saldo muy visibles.
- Monto recibido editable.
- Botón final grande: “Crear ficha y generar enlace”.
- Después de crear: “Copiar enlace”, “Abrir WhatsApp”, “Nueva cita”.
- Targets táctiles de al menos ~44 px.
- Evitar scroll innecesario.
- Errores junto al campo/paso.
- Loading y prevención de doble envío.
- Diseño desde 360 px en adelante.
- Mantener versión desktop profesional.

Esta fase NO debe modificar SQL, Supabase, RPC ni reglas de negocio salvo que aparezca un bloqueo explícito.

## 9. Flujo futuro para agregar nuevos servicios

Objetivo acordado: no repetir la migración grande cada vez.

Proceso futuro esperado:

`Actualizar catálogo canónico → validar → publicar release → sync Caja → smoke test → listo`

Si el nuevo servicio usa una regla ya existente (`ONE_PERSON`, `FIXED_TWO_PACKAGE`, `HOME_FLOW`, etc.), no debería requerir modificar `Preparar cita`.

Solo una modalidad/regla de negocio nueva debería obligar a ampliar el contrato.

## 10. Idea futura — Recompra / beneficio de regreso

La recompra/postventa ya estaba contemplada conceptualmente en las fuentes del proyecto. La regla concreta propuesta ahora es:

- beneficio: S/10 de descuento;
- vigencia: 15 días desde la atención/activación correspondiente;
- una sola vez por cliente dentro del periodo;
- no acumulable con otras promociones;
- servicios elegibles definidos;
- registrar fecha de expiración;
- estado: emitido/usado/vencido.

Ejemplo visible para cliente:

“Gracias por elegir Vita Lima. Tienes S/10 de descuento en tu próxima visita, válido hasta [fecha].”

Esta lógica debe implementarse como una fase posterior, no mezclarse con la actual refactorización UX.

## 11. Ficha pública y dominio Vita Lima

La ficha/enlace del cliente bajo el dominio de Vita Lima puede aportar:

- tráfico recurrente al dominio;
- confianza de marca;
- mejor continuidad de experiencia;
- oportunidad de recompra y postventa.

No se debe considerar la ficha privada como una táctica SEO principal ni hacerla indexable si contiene información personal.

## 12. Próximos pasos exactos

1. Terminar 3B.1-B UX móvil.
2. Revisar visualmente en móvil y desktop.
3. Ejecutar tests/typecheck/lint/build.
4. Revisar PR de UX.
5. Mergear si pasa auditoría.
6. Redeploy único de Caja en Contabo.
7. Probar `Preparar cita` en producción con casos controlados:
   - 1 persona individual;
   - 2 personas con paquete;
   - 2 personas con un servicio por persona;
   - HOME Miraflores;
   - HOME distrito S/30;
   - HOME distrito no configurado;
   - adelanto mínimo vs. monto recibido real.
8. Recién después continuar con otros módulos (por ejemplo Nueva atención) y con la fase de recompra.

## 13. Regla de trabajo

Siempre que sea posible, las operaciones GitHub (revisión de PR, merge, verificación de branch/commit) pueden ser ejecutadas directamente por ChatGPT si la conexión lo permite, especialmente cuando Gerald esté trabajando desde móvil.

Para acciones que dependan de la PC local, SQL Editor de Supabase o SSH/Contabo, se entregarán pasos mínimos y exactos.
