# Caja Vita Lima — cambios para la ficha de cita

Repo: `github.com/gperezdev-aut/caja-vita-lima` (Next.js + Supabase + Vercel)
Documento hermano, para la web pública: `encargo-web-ficha-cita.md`
Razonamiento completo: doc `claude/ficha-cita-formulario-propio.md` del proyecto vita-web.

**Este trabajo va después del de la web**, pero el contrato de la sección 6 hay que fijarlo antes
de que cualquiera de los dos empiece: es lo que permite que avancen en paralelo.

---

## 0. Antes de nada: el README está desactualizado

El `README.md` dice *«Current Phase: technical planning and database preparation»* e
*«Implemented: None yet»*. Eso ya no es cierto: el repo tiene **12 migraciones SQL**, vistas de
dashboard, reportes financieros mensuales y por socio, comprobantes pendientes y control de
intentos de login.

**No planificar contra el README.** Leer `sql/`, `app/` y `lib/` para saber qué existe de verdad,
y de paso actualizar el README al terminar.

## 1. Lo que ya está modelado y no hay que inventar

Buena parte del diseño ya tiene casa en el esquema actual:

| Concepto del flujo nuevo | Dónde vive ya |
|---|---|
| Cliente identificado por su WhatsApp | `clientes.whatsapp`, con `dni`, `email`, `ultima_sede`, `segmento_cliente` |
| La cita reservada | `citas_reservadas` (fecha, hora, sede, cliente, servicio, monto, estado) |
| El saldo pendiente | `caja_movimientos.total_pagado` y `.pendiente` |
| El adelanto | `caja_pagos` → `tipo_pago = adelanto`, `metodo = Yape/Plin/transferencia/efectivo`, `monto` |
| El canal cupón y su neto | `cupones_convenios` (`plataforma`, `codigo_cupon`, `monto_reconocido`) |
| Roles y permisos | `lib/auth.ts` — **ADMIN_GERALD, SOCIO, VITA_OPERACION** (corregido — ver nota) |

El adelanto de S/10 de una cita entra como una fila de `caja_pagos` con `tipo_pago = adelanto`.
Eso resuelve, ya, el pendiente que quedó anotado en `adelantos-y-confirmacion-reservas.md`: que
el adelanto se refleje en caja como pago parcial de la cita y no se anote aparte.

> **Corrección (revisión de código, sept. 2026):** esta fila decía antes `ADMIN_GERALD, CAJA,
> FINANZAS, LECTURA`. Ese es el rol que trae el *seed* SQL (`sql/002_seed_initial_data.sql`), pero
> el módulo que de verdad controla accesos, `lib/auth.ts` (`CajaRole`, `PERMISSIONS`), usa otro
> modelo: **`ADMIN_GERALD`, `SOCIO`, `VITA_OPERACION`**. Son dos cosas desalineadas dentro del
> propio repo, no solo el doc contra el código. **Deuda técnica anotada, no se corrige en este
> cambio** — ver §10.

**Decisión del dueño sobre quién ve `fichas_salud`** (reemplaza lo que decía la sección 2 más
abajo): los **tres roles la ven — `ADMIN_GERALD`, `SOCIO` y `VITA_OPERACION`**. Los socios ven todo
el negocio, y `VITA_OPERACION` es el rol operativo (la terapista) que necesita saber si la clienta
está embarazada o tiene la presión alta para atenderla sin riesgo. No es una restricción por rol
como se pensó originalmente — es visible para cualquiera que tenga sesión.

## 2. Migración 013 — lo que falta

### `citas_reservadas`

| Columna | Tipo | Para qué |
|---|---|---|
| `token_ficha` | `text unique` | Lo único que autentica al cliente. **Largo y aleatorio** — ver §7 |
| `token_expira` | `timestamptz` | Después de la cita el enlace no abre más |
| `estado_ficha` | `text` | `pendiente` \| `completa` |
| `canal` | `text` | `directo` \| `cuponidad` \| `bee` |
| `requiere_confirmacion` | `boolean` | true en canal cupón y en teléfono no peruano |
| `confirmado_en` | `timestamptz` | Cuándo respondió el «SÍ» de las 24 h |
| `personas` | `smallint` | 1 o 2. Define el tramo del adelanto |
| `idioma` | `text` | `es` \| `en` |
| `duracion_min` | `int` | Duración real del bloque, ya con los +10 min del beneficio si aplica |
| `terapista_preferida` | `text` | Opcional |
| `calendar_event_id` | `text` | Para poder actualizar o cancelar el evento después |
| `cupon_vigente_hasta` | `timestamptz` | Fecha máxima del cupón — ver nota |

**`cupon_vigente_hasta` va en `citas_reservadas`, no en `cupones_convenios`.** El GET de la sección
6 necesita `cupon.vigenteHasta` **antes** de que el cliente escriba el código del cupón, o sea
antes de que exista la fila en `cupones_convenios`. Es una propiedad de la promoción que el equipo
elige al armar la cita (pantalla de §3), no del cupón que el cliente declara después. Así el GET
lee una sola fila y no depende de una que puede no existir todavía.

> Nota: `calendar_event_id` ya existe desde `001_create_tables.sql` — no es una columna nueva de
> la 013, se lista acá porque el documento original la mencionaba como si faltara.

### `caja_pagos` — una columna nueva (faltaba)

La sección 3 de abajo dice que al registrar el pago se anota monto, método **y número de
operación**, y que ese número es lo que después deja cuadrar caja sin abrir el chat. La tabla
`caja_pagos` no tenía dónde guardarlo — se agrega `numero_operacion text`.

### `clientes`

| Columna | Tipo | Para qué |
|---|---|---|
| `whatsapp_e164` | `text unique` | **La nueva llave.** Normalizado: `+51987654321` |
| `pais_telefono` | `text` | ISO-2, derivado del número |
| `idioma` | `text` | Para abrir la ficha en su idioma la próxima vez |
| `cumple_dia`, `cumple_mes` | `smallint` | Sin año: sirve para saludar, no para identificar |
| `consent_datos_en` | `timestamptz` | La fecha **es** la prueba del consentimiento |
| `consent_promos_en` | `timestamptz` | Sin esto no se le puede mandar post-venta |

Migrar los `whatsapp` existentes a `whatsapp_e164` asumiendo Perú donde no haya prefijo, y
revisar a mano los que no normalicen.

### `fichas_salud` — tabla nueva y aparte

Va separada **a propósito**: es dato sensible de categoría especial y no puede compartir tabla
con «¿qué servicio quieres?».

```
ficha_id, reserva_id, cliente_id,
embarazo bool, presion bool, cirugia_reciente bool,
alergias text, zonas_evitar text, notas text,
consent_salud_en timestamptz, creado_en timestamptz
```

**Sin restricción por rol.** Corrige lo que decía antes esta sección (`solo CAJA y ADMIN_GERALD`):
el dueño decidió que los tres roles reales del sistema — `ADMIN_GERALD`, `SOCIO` y
`VITA_OPERACION` — ven esta tabla. Ver la nota de la sección 1. Como no hay RLS en este proyecto
(todo pasa por la service role key, sección 6), esto no cambia nada en SQL: solo importa el día que
se construya la pantalla interna que lea `fichas_salud` (§3), para no filtrar el control de acceso
ahí por error.

**Decidido: si el cliente marca «Ninguna de las anteriores», NO se crea fila.** Es la lectura
literal de «si no hay dato sensible que guardar, no hay nada que consentir» (regla de
consentimientos, sección 6): no hay condición → no hay dato sensible → no hay fila. La alternativa
(crear la fila igual, con los tres booleanos en `false` y `consent_salud_en` en `null`) se descartó
porque ese `null` es ambiguo — no distingue «no marcó nada» de «se le olvidó pedir el consentimiento»
— y porque una fila entera de `false` no aporta nada que la ausencia de fila no diga ya. Para la
pantalla interna (§3): **sin fila en `fichas_salud` = sin condiciones declaradas**, no «sin ficha
completada» (eso lo dice `citas_reservadas.estado_ficha`).

### `cupones_convenios`

- **Restricción única sobre `(plataforma, codigo_cupon)`.** Es lo que corta el reenvío del mismo
  cupón, que es el fraude barato y frecuente de ese canal.
- `estado`: `declarado` (lo escribió el cliente) → `verificado` (alguien lo cruzó con el panel de
  la plataforma) → `canjeado` (mostró el QR y se atendió).
- `reserva_id`, para atarlo a la cita.
- **No lleva `vigente_hasta`** — esa fecha vive en `citas_reservadas.cupon_vigente_hasta` (ver
  arriba), no acá.

No hay API pública de Cuponidad: el canje real ocurre en el local mostrando el QR. Lo que el
cliente escribe es una **declaración**. Ninguna pantalla debe decir «cupón validado».

### `beneficios` — dejar creada, se usa en la etapa 4

```
beneficio_id, whatsapp_e164, tipo ('REACT-10' | 'REACT-MIN'),
emitido_en, vence_el, estado, reserva_id_canje
```

`estado`: `disponible` → `reservado` → `canjeado`, o de vuelta a `disponible` si el cliente
cancela — **liberar no renueva**: `vence_el` se fija al emitir y no se mueve.

### `sedes` — tabla nueva

No estaba en el plan original, pero se justifica sola: hoy no hay ningún lugar en el esquema con
la dirección o el enlace de Maps de una sede — `config_listas` solo guarda el nombre
(`lista='SEDES'`, `valor='San Borja'`). El GET de la sección 6 necesita `sedeDireccion` y
`sedeMapsUrl`, y la pantalla interna (§3) va a necesitar además el horario real: San Borja abre a
las 15:00 y hoy no hay dónde leerlo.

```
sede_id, nombre, direccion, maps_url, hora_apertura, hora_cierre, activo
```

Se crea con una fila por sede (`San Borja`, `Miraflores` — confirmado por el dueño que son las dos
sedes reales y que coinciden con `citas_reservadas.sede`) y con datos reales, no un placeholder:
dirección, `maps_url` y horario salen de `content/locations.ts` del repo `vita-lima-web`.

San Borja abre 15:00–20:00, Miraflores 11:00–20:00. `locations.ts` describe el horario de San Borja
como *«principalmente de 3 a 8 p.m.»* — el «principalmente» no cabe en una columna `time`, así que
queda `15:00`–`20:00` fijo y se ajusta a mano si en la práctica hay excepciones.

**Estos horarios son los que la pantalla interna (§3) tiene que usar para filtrar las horas que
ofrece.** Hoy no existe ese filtro — por eso hoy se puede pedir una cita a las 11 a.m. en San Borja
aunque abra a las 3 p.m. Construir esa pantalla sin leer `sedes.hora_apertura`/`hora_cierre` deja
el mismo hueco abierto.

`politicaCancelacionUrl`, en cambio, **no** va en esta tabla ni en ninguna: es la misma URL para
las dos sedes, así que es una variable de entorno (`CAJA_POLITICA_CANCELACION_URL`), no un dato de
negocio que necesite vivir en Supabase.

## 3. La pantalla interna del equipo

Es lo que en el plan de la web se llamaba `/cita/nueva`, y **no se construye en la web**: es una
pantalla de caja, probablemente una extensión de «reserva futura» / «nueva atención».

Flujo en dos toques, que es como ocurre de verdad:

1. **Armar la cita** — canal, servicios, personas, sede, fecha, hora. Muestra el adelanto que
   corresponde según el tramo. Todavía no manda nada.
2. **Registrar el pago y mandar** — cuando llega el Yape: monto, método, número de operación.
   Entonces genera el token y muestra **un solo botón «copiar mensaje»**, con el enlace ya dentro
   del texto. Un botón, no dos bloques: en un celular, copiar dos veces es error seguro.

La implementación vive en `/preparar-cita` y usa la RPC
`preparar_ficha_cita` de `sql/014_preparar_ficha_cita_transaccional.sql`.
La función valida nuevamente sede, horario, personas, servicios y adelanto, y
guarda cliente, movimiento, cita, pago y detalle dentro de una sola transacción.
El token solo forma parte de la cita si todo lo anterior termina correctamente.

Para el primer lanzamiento, `/preparar-cita` queda restringido en interfaz,
server action y RPC a canal directo sin promociones ni gift cards. Cuponidad,
Bee Beneficios, promociones y gift cards continúan en el proceso actual. Sus
tablas y lógica histórica se conservan, pero no se crean nuevas citas de esos
tipos hasta cerrar sus reglas económicas.

`sql/016_ficha_cita_hardening.sql` agrega un `request_id` único por intento. Un
reintento idéntico devuelve la misma reserva y token; el mismo identificador
con otro contenido devuelve conflicto. También evita borrar email, DNI,
cumpleaños o consentimiento promocional previo, rechaza un WhatsApp asociado a
otro cliente y sincroniza la identidad en cliente, cita y movimiento.

**Cuponidad no es un cupón promocional común.** `canal = 'cuponidad'`
representa un convenio de pago posterior: adelanto cero y confirmación manual,
sin importar el país del teléfono. `canal = 'bee'` conserva el enum ya existente
y se persiste como plataforma `Bee Beneficios`; el modelo histórico
(`cupones_convenios`, `codigo_cupon`, `monto_reconocido`) confirma el mismo
tratamiento de convenio. En cambio, un código de `stg_promotions_v1` solo ajusta
el precio total y mantiene la política normal de adelanto (S/10 para una persona,
50% para dos), salvo una regla específica futura que deberá modelarse de forma
explícita.

El teléfono extranjero se acepta y normaliza a E.164, pero por sí solo no cambia
el adelanto ni activa `requiere_confirmacion`.

Reglas que salen de las decisiones ya tomadas:

- **No se manda el enlace hasta que el pago esté verificado.** El enlace *es* la prueba del pago.
  Cuponidad y Bee Beneficios son convenios de pago posterior: llevan adelanto cero y
  `requiere_confirmacion = true`. Un teléfono extranjero no constituye una excepción económica.
- **El monto viene propuesto pero editable.** La gente yapea de más, redondea, o paga el total
  completo. Un campo fijo obliga a mentir y descuadra el saldo.
- El **número de operación** es lo que después deja cuadrar caja sin abrir el chat.

UX, porque esta pantalla se usa veinte veces al día con otro chat esperando: los 6 servicios más
vendidos como botones grandes y el catálogo detrás de «ver todos»; atajos «hoy / mañana / sábado»
antes del calendario; horas como chips, no desplegable; recordar la sede anterior; que se pueda
completar con una mano.

## 4. Tres vistas operativas

- **Por confirmar mañana** — vista futura para citas con `requiere_confirmacion` y sin
  `confirmado_en`. El botón de confirmación operativa será el siguiente módulo; liberar horario
  o devolver dinero no se implementa sin una política económica explícita.
- **Pagadas sin ficha completa** — `estado_ficha = pendiente` con adelanto registrado. Es plata
  cobrada con una cita a medias: sin correo y sin ficha de salud. Sirve para reenviar el enlace
  antes de que la persona llegue al local.
- **Cupones por verificar** — `estado = declarado`, para cruzarlos contra el panel de la
  plataforma.

## 5. Calendar y WhatsApp

**Google Calendar** — la Caja genera el archivo ICS del lado del servidor cuando la ficha se completa:
título `Nombre — Servicio — Sede`, cliente invitado, recordatorios a 24 h y 2 h, y **zona horaria
`America/Lima` explícita**. Sin la zona explícita, un cliente que todavía no viaja abre el `.ics`
con el reloj de su país y ve otra hora; eso produce un plantón entero. Guardar el
`calendar_event_id`.

`estado_ficha = completa` significa únicamente que los datos del cliente fueron recibidos. No
significa que una cita pendiente tenga cobertura o terapistas confirmados; eso depende de
`confirmado_en` y se comunica por separado.

Consultar `freeBusy` del calendario de la sede **antes** de ofrecer los +10 minutos del beneficio
(etapa 4): si no caben, no se ofrecen. Nunca ofrecer algo que después haya que quitar. Esa misma
consulta es el primer paso hacia mostrar disponibilidad real en la web.

**WhatsApp Cloud API** — ya está contemplada en el stack, y eso cambia una advertencia anterior:
con la API oficial y plantillas aprobadas, la confirmación de 24 h y el mensaje del beneficio se
pueden automatizar de verdad. Desde un número personal no: el riesgo es que bloqueen el canal de
venta. Mientras la API no esté lista, las vistas de §4 con el mensaje copiable hacen el trabajo a
mano y no bloquean nada.

## 6. El contrato con la web pública — fijar esto primero

La web **no toca Supabase**. No tiene credenciales de la base, no conoce el esquema y no calcula
precios ni adelantos: caja se los manda ya calculados. Son dos endpoints, servidor contra
servidor, autenticados con un secreto compartido en cabecera.

> **Este contrato ya está cerrado y en producción del lado de la web** (PR #38 de `vita-lima-web`,
> rama `feat/ficha-cita`, y su `docs/encargo-web-ficha-cita.md`). Lo de abajo no es una propuesta:
> es lo que la web ya espera recibir. Cualquier cambio hay que acordarlo en los dos repos a la vez.

### Autenticación

Variable `CAJA_API_SECRET`, mandada en la cabecera `X-Caja-Secret`. **Las cabeceras llegan en
minúsculas**: comparar contra `x-caja-secret`. Esto ya costó tiempo una vez con el webhook de n8n.

### `GET /api/publico/ficha/:token`

```json
{
  "contratoVersion": "ficha-cita-v1",
  "token": "…",
  "estado": "pendiente",
  "idioma": "es",
  "canal": "directo",
  "cita": {
    "fecha": "2026-09-13",
    "hora": "16:00",
    "sede": "San Borja",
    "sedeDireccion": "…",
    "sedeMapsUrl": "…",
    "personas": 1,
    "servicios": [{ "nombre": "Espalda Libre", "duracionMin": 60 }],
    "duracionTotalMin": 60
  },
  "pago": {
    "moneda": "PEN",
    "adelantoRecibido": 10.0,
    "saldo": 65.0,
    "leyenda": "Adelanto recibido"
  },
  "requiere": {
    "codigoCupon": false,
    "correoObligatorio": false,
    "documentoParaBoleta": "opcional",
    "confirmacionManual": false,
    "motivoConfirmacion": null
  },
  "cliente": { "conocido": true, "nombre": "Rosa", "emailEnmascarado": "r***@gmail.com" },
  "politicaCancelacionUrl": "…"
}
```

`confirmacionManual` solo es `true` mientras `requiere_confirmacion=true` y
`confirmado_en` siga vacío. `motivoConfirmacion` vale `"domicilio"` para una
atención a domicilio o `"convenio"` para Cuponidad/Bee; una vez confirmada la
cita ambos vuelven a `false`/`null`. Un teléfono extranjero nunca activa esta
regla por sí solo.

`documentoParaBoleta` tiene **solo dos valores: `"no"` y `"opcional"`**. No existe `"obligatorio"`
— el DNI es opcional a propósito. En canal cupón siempre viene `"no"`, porque la boleta la emite
la plataforma.

En un convenio histórico, `pago.adelantoRecibido = 0`, `pago.saldo = 0` y la
leyenda indica que el pago es gestionado por Cuponidad o Bee. Ese saldo es la
deuda visible del cliente, no una cuenta por cobrar a la plataforma. No se
inventa `monto_reconocido`: su contabilización queda fuera del MVP.

En canal cupón, además, `requiere.codigoCupon = true` y llega un `cupon.vigenteHasta` que la web usa como fecha máxima. Ese
valor sale de `citas_reservadas.cupon_vigente_hasta` (sección 2) — no de una fila de
`cupones_convenios`, que en este punto todavía no existe (el cliente aún no escribió el código).

### `POST /api/publico/ficha/:token`

```json
{
  "telefono": { "crudo": "987 654 321", "pais": "PE" },
  "nombre": "Rosa Quispe",
  "correo": "rosa@ejemplo.com",
  "cumple": { "dia": 14, "mes": 3 },
  "boleta": { "requiere": true, "tipo": "DNI", "numero": "12345678", "razonSocial": null },
  "salud": {
    "embarazo": false, "presion": true, "cirugiaReciente": false,
    "alergias": "", "zonasEvitar": "", "notas": ""
  },
  "consentimientos": { "datos": true, "salud": true, "promociones": false },
  "codigoCupon": null,
  "idioma": "es"
}
```

- `boleta.tipo` es `"DNI"` o `"RUC"`. `cumple` y `codigoCupon` pueden ser `null`.
- `codigoCupon` es obligatorio únicamente para `canal = "cuponidad"` o `"bee"`. Una cita de
  canal directo debe enviarlo vacío o `null`; Caja lo rechaza si llega un valor y nunca registra
  una plataforma `directo` en `cupones_convenios`.
- **Los consentimientos llegan como booleanos, no como fechas.** La marca de tiempo la pone caja
  con su propio reloj al recibirlos: esa fecha es la prueba legal y no puede depender del reloj
  del celular del cliente.
- `idioma` es el que eligió la persona en la página. Guardarlo en `clientes.idioma` para que la
  próxima ficha abra ya en ese idioma.
- Caja normaliza `telefono` a E.164 con el país recibido.

**Regla de consentimientos (decisión del dueño):**

| Consentimiento | ¿Obligatorio? |
|---|---|
| `datos` | **Sí, siempre.** Sin él no hay forma de procesar la reserva → `422 validacion` si viene `false`. |
| `salud` | **Solo si el cliente marcó alguna condición** en el bloque `salud`. Si eligió «Ninguna de las anteriores», no hay dato sensible que guardar y por lo tanto nada que consentir — condicionar todo el servicio a un consentimiento que puede no hacer falta lo vuelve un consentimiento no libre. |
| `promociones` | **Nunca obligatorio.** |

Esto implica un cambio chico del lado de la web: la casilla de consentimiento de salud debe
aparecer solo si el cliente marcó alguna condición en ese bloque. **No es parte de este documento
ni de este repo** — queda anotado para el PR #38 de `vita-lima-web`.

Respuesta `200`:

```json
{
  "ok": true,
  "icsUrl": "...",
  "whatsappUrl": "...",
  "resumen": {
    "fecha": "2026-09-13", "hora": "16:00",
    "sede": "San Borja", "sedeDireccion": "...", "sedeMapsUrl": "...",
    "servicios": [{ "nombre": "Espalda Libre", "duracionMin": 60 }],
    "duracionTotalMin": 60, "tipoAtencion": "sede", "personas": 1,
    "domicilio": null,
    "moneda": "PEN", "adelantoRecibido": 10.0, "saldo": 65.0
  }
}
```

El `.ics` lo genera caja, con `America/Lima` explícito, para que la lógica de zona horaria viva
en un solo sitio. `icsUrl` apunta a `GET /api/publico/ficha/:token/ics` — es un endpoint nuevo,
fuera del par servidor-a-servidor de arriba: lo abre directo el navegador del cliente (el botón
«agregar a mi calendario»), así que **no** lleva `X-Caja-Secret` — solo el token, con el mismo
límite de intentos por IP que el resto (§7). El VEVENT declara `TZID=America/Lima` con un
`VTIMEZONE` embebido de offset fijo `-05:00` (Perú no tiene horario de verano), para que no
dependa de que el calendario del cliente conozca esa zona.

`whatsappUrl` es un enlace `wa.me` **al número del negocio**, con un mensaje prellenado que
identifica la cita — del tipo *«Hola, tengo una consulta sobre mi cita del sábado 13 a las 4:00
p.m. en San Borja»* — para que el cliente pueda pedir un cambio sin tener que explicar cuál es su
reserva. El número sale de una variable de entorno (`CAJA_WHATSAPP_NEGOCIO`).

Un evento pendiente incluye `STATUS:TENTATIVE` y “Pendiente de confirmación”
en el título; uno confirmado usa `STATUS:CONFIRMED`. Las líneas se pliegan al
límite de 75 octetos de RFC 5545. En domicilio nunca se expone la sede
operativa: ubicación y descripción usan distrito, dirección y referencia.

### Solicitudes de comprobante

La migración 016 crea `solicitudes_comprobante`. DNI genera BOLETA y puede
actualizar `clientes.dni`; RUC genera FACTURA, exige razón social y nunca se
guarda en `clientes.dni`. Al solicitar comprobante el movimiento queda
`estado_boleta = "Pendiente"`; al no solicitar, `"No aplica"`. `numero_boleta`
permanece vacío hasta la emisión real.

### Errores

Caja manda **solo un código legible por máquina**: `{ "error": "cupon_ya_usado", "mensaje": "..." }`.
Los textos que ve el cliente son de la web, en español e inglés. **Caja no traduce ni escribe
copy** — `mensaje` es solo un respaldo por si la web recibe un código que no conoce.

| Código | HTTP | Cuándo |
|---|---|---|
| `token_no_existe` | 404 | El token no está en `citas_reservadas` |
| `token_vencido` | 410 | Pasó `token_expira` |
| `ficha_ya_completa` | 410 | `estado_ficha = completa` |
| `identificacion_no_valida` | 403 | El WhatsApp no coincide o no puede normalizarse; el mensaje no revela datos de terceros |
| `error_interno` | 500 | No fue posible leer de forma segura el historial recurrente |
| `telefono_asociado_otro_cliente` | 409 | El WhatsApp pertenece a un `cliente_id` distinto; no se fusiona ni se escribe nada |
| `cupon_ya_usado` | 409 | Choca con la restricción única de `cupones_convenios` |
| `validacion` | 422 | Error de campo |

**Toda la validación se repite en el servidor.** Lo que valida la web es comodidad para el
cliente; lo que decide es caja.

### Identificación segura de cliente recurrente

`POST /api/publico/ficha/:token/identificar` agrega un contrato independiente y no modifica
`ficha-cita-v1`. Requiere `X-Caja-Secret` y acepta solamente:

```json
{
  "telefono": {
    "crudo": "987654321",
    "pais": "PE"
  }
}
```

Caja valida primero el token (existencia, vigencia y ficha pendiente), normaliza el número con
`libphonenumber-js` y lo compara únicamente con `clientes.whatsapp_e164` del `cliente_id`
asociado a la reserva. Antes de coincidir solo consulta `cliente_id` y `whatsapp_e164`. No busca
clientes por número ni devuelve datos ante un fallo. La respuesta exitosa exacta es:

```json
{
  "contratoVersion": "ficha-recurrente-v1",
  "clienteRecurrente": true,
  "cliente": {
    "nombre": "Rosa Quispe",
    "correo": "rosa@example.com",
    "cumple": { "dia": 14, "mes": 3 },
    "promociones": {
      "autorizoAnteriormente": true,
      "requiereNuevaAceptacion": true
    }
  },
  "saludAnterior": {
    "disponible": true,
    "sinCondicionesDeclaradas": false,
    "embarazo": false,
    "presion": true,
    "cirugiaReciente": false,
    "alergias": "Látex",
    "zonasEvitar": "Rodilla izquierda",
    "notas": null
  },
  "comprobanteAnterior": {
    "tipoComprobante": "FACTURA",
    "tipoDocumento": "RUC",
    "numeroDocumento": "20123456789",
    "razonSocial": "Rosa Servicios SAC",
    "solicitarEnNuevaCita": false
  }
}
```

`clienteRecurrente` es verdadero cuando existe una cita anterior con ficha completa para el mismo
`cliente_id`, una ficha de salud anterior o un comprobante anterior. La fila más reciente de
`fichas_salud`, excluyendo la reserva actual, se devuelve como fotografía editable. Si no existe
ninguna pero sí una cita anterior completa, se devuelve `sinCondicionesDeclaradas=true`, de
acuerdo con la semántica histórica; sin historial, `saludAnterior` es `null`. El comprobante es el
más reciente del mismo cliente, excluyendo la reserva actual. Nunca se devuelve el teléfono.

Los campos anulables conservan `null`. `comprobanteAnterior.solicitarEnNuevaCita` siempre es
`false` y `cliente.promociones.requiereNuevaAceptacion` siempre es `true`: la web puede ofrecer
reutilizar datos, pero no marcar esas decisiones automáticamente. Si el cliente confirma que todo
sigue igual, la web debe reenviar esos valores al `POST ficha-cita-v1`; esa RPC crea o actualiza
solamente la declaración de la reserva actual y no toca fichas históricas. Una observación nueva va
en `salud.notas`, junto con la fotografía reenviada y el consentimiento de salud aplicable.

Errores del endpoint: `no_autorizado` (401), `token_no_existe` (404), `token_vencido` o
`ficha_ya_completa` (410), `identificacion_no_valida` (403), `rate_limited` (429) y
`error_interno` (500). Todos incluyen `Cache-Control: no-store` y
`X-Robots-Tag: noindex, nofollow, noarchive`. Los intentos de identificación usan una clave
separada por IP y token durante 15 minutos; la única escritura de este endpoint es ese control de
seguridad. No modifica `clientes`, `citas_reservadas`, `fichas_salud` ni
`solicitudes_comprobante`.

No se requiere migración 017: las tablas aplicadas hasta 016 contienen todas las referencias y
campos necesarios.

## 7. Seguridad del token

Ese token es lo único que protege una ficha de salud, así que:

- **Largo y aleatorio.** En un plan anterior propuse 6 caracteres legibles, y estaba pensado para
  que alguien lo dictara. Nadie lo dicta: el cliente toca un enlace. Que sea largo no le cuesta
  nada a nadie.
- **Que expire** con `token_expira` al terminar la atención o después. Caja calcula el valor como
  `inicio + duracion_min`; ese instante exacto es válido y solo se rechaza una expiración anterior
  al final completo de la cita.
- **Ningún endpoint que liste.** Solo «traer por token». Sin listado, un token filtrado expone una
  cita; con listado, expondría el padrón.
- **Límite de intentos por IP** en el endpoint público. El patrón ya existe en el repo:
  `012_login_intentos.sql`.
- El secreto compartido con la web vive en variable de entorno de ambos lados, nunca en el
  navegador: la web llama a caja **desde su servidor**.

## 8. Lo que NO va en caja

- La página que ve el cliente. Vive en la web pública, por marca y para no exponer a internet la
  misma aplicación que tiene el dashboard financiero y los PIN de acceso.
- Cobro con pasarela. Sigue descartado para el grueso (~4 % sobre un adelanto de S/10 es absurdo).
  Se evaluará solo para el segmento turista, que no puede yapear, y para packs grandes — y recién
  con datos de cuántos se plantan.

## 9. Al terminar

- Actualizar el `README.md`, que hoy describe un proyecto que ya no existe.
- Anotar la migración 013 y los dos endpoints en `docs/`.

## 10. Deuda técnica anotada, no resuelta en este cambio

Cosas que aparecieron revisando el código para este documento, que no se arreglan acá porque no
son parte de la ficha de cita, pero que hay que tener anotadas:

- **Roles desalineados dentro del propio repo.** `sql/002_seed_initial_data.sql` siembra
  `usuarios.rol` con `ADMIN_GERALD / CAJA / FINANZAS / LECTURA`. `lib/auth.ts`, que es el módulo
  que de verdad controla accesos, define `ADMIN_GERALD / SOCIO / VITA_OPERACION`. No son solo
  nombres distintos — son dos modelos de rol distintos conviviendo en el mismo sistema. Alguien
  tiene que decidir cuál es el real y limpiar el otro.
- **Generador de ids no criptográfico, duplicado en varios archivos.** `app/nueva-atencion/actions.ts`,
  `app/registrar-salida/actions.ts` y `app/cierre-caja/actions.ts` tienen cada uno su propia copia
  idéntica de una función `id(prefix)` que arma `PREFIX-APP-<timestamp36>-<Math.random hex>` para
  `reserva_id`, `movimiento_id`, `pago_id`, `salida_id`, `cierre_id`, etc. Sirve para identificadores
  de registro (no protegen nada, solo tienen que no colisionar), así que `Math.random` no es un bug
  de seguridad ahí — pero sí es código triplicado que podría vivir en un solo helper de `lib/`.
  `app/api/publico/ficha/[token]/route.ts` (este cambio) sigue el mismo patrón para
  `ficha_id`/`registro_id` de cupón, por consistencia con el resto del repo — **no** para el
  `token_ficha`, que sí protege datos de salud y por eso usa `crypto.randomBytes` (§7).
