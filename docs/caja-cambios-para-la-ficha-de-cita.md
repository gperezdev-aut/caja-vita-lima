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
| Roles y permisos | `usuarios.rol` — ADMIN_GERALD, CAJA, FINANZAS, LECTURA |

El adelanto de S/10 de una cita entra como una fila de `caja_pagos` con `tipo_pago = adelanto`.
Eso resuelve, ya, el pendiente que quedó anotado en `adelantos-y-confirmacion-reservas.md`: que
el adelanto se refleje en caja como pago parcial de la cita y no se anote aparte.

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

**Restringir por rol: solo CAJA y ADMIN_GERALD.** FINANZAS y LECTURA no tienen ninguna razón
para ver si una clienta está embarazada. Con los cuatro roles que ya existen esto es una policy,
no un rediseño.

### `cupones_convenios`

- **Restricción única sobre `(plataforma, codigo_cupon)`.** Es lo que corta el reenvío del mismo
  cupón, que es el fraude barato y frecuente de ese canal.
- `estado`: `declarado` (lo escribió el cliente) → `verificado` (alguien lo cruzó con el panel de
  la plataforma) → `canjeado` (mostró el QR y se atendió).
- `reserva_id`, para atarlo a la cita.

No hay API pública de Cuponidad: el canje real ocurre en el local mostrando el QR. Lo que el
cliente escribe es una **declaración**. Ninguna pantalla debe decir «cupón validado».

### `beneficios` — dejar creada, se usa en la etapa 4

```
beneficio_id, whatsapp_e164, tipo ('REACT-10' | 'REACT-MIN'),
emitido_en, vence_el, estado, reserva_id_canje
```

`estado`: `disponible` → `reservado` → `canjeado`, o de vuelta a `disponible` si el cliente
cancela — **liberar no renueva**: `vence_el` se fija al emitir y no se mueve.

## 3. La pantalla interna del equipo

Es lo que en el plan de la web se llamaba `/cita/nueva`, y **no se construye en la web**: es una
pantalla de caja, probablemente una extensión de «reserva futura» / «nueva atención».

Flujo en dos toques, que es como ocurre de verdad:

1. **Armar la cita** — canal, servicios, personas, sede, fecha, hora. Muestra el adelanto que
   corresponde según el tramo. Todavía no manda nada.
2. **Registrar el pago y mandar** — cuando llega el Yape: monto, método, número de operación.
   Entonces genera el token y muestra **un solo botón «copiar mensaje»**, con el enlace ya dentro
   del texto. Un botón, no dos bloques: en un celular, copiar dos veces es error seguro.

Reglas que salen de las decisiones ya tomadas:

- **No se manda el enlace hasta que el pago esté verificado.** El enlace *es* la prueba del pago.
  Dos excepciones explícitas: canal cupón y teléfono no peruano, que van con adelanto cero y
  `requiere_confirmacion = true`.
- **El monto viene propuesto pero editable.** La gente yapea de más, redondea, o paga el total
  completo. Un campo fijo obliga a mentir y descuadra el saldo.
- El **número de operación** es lo que después deja cuadrar caja sin abrir el chat.

UX, porque esta pantalla se usa veinte veces al día con otro chat esperando: los 6 servicios más
vendidos como botones grandes y el catálogo detrás de «ver todos»; atajos «hoy / mañana / sábado»
antes del calendario; horas como chips, no desplegable; recordar la sede anterior; que se pueda
completar con una mano.

## 4. Tres vistas operativas

- **Por confirmar mañana** — citas con `requiere_confirmacion` y sin `confirmado_en`, con el
  mensaje listo para copiar y botones «confirmada» / «liberar horario».
- **Pagadas sin ficha completa** — `estado_ficha = pendiente` con adelanto registrado. Es plata
  cobrada con una cita a medias: sin correo y sin ficha de salud. Sirve para reenviar el enlace
  antes de que la persona llegue al local.
- **Cupones por verificar** — `estado = declarado`, para cruzarlos contra el panel de la
  plataforma.

## 5. Calendar y WhatsApp

**Google Calendar** — el evento lo crea caja, del lado del servidor, cuando la ficha se completa:
título `Nombre — Servicio — Sede`, cliente invitado, recordatorios a 24 h y 2 h, y **zona horaria
`America/Lima` explícita**. Sin la zona explícita, un cliente que todavía no viaja abre el `.ics`
con el reloj de su país y ve otra hora; eso produce un plantón entero. Guardar el
`calendar_event_id`.

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
    "documentoParaBoleta": "opcional"
  },
  "cliente": { "conocido": true, "nombre": "Rosa", "emailEnmascarado": "r***@gmail.com" },
  "politicaCancelacionUrl": "…"
}
```

`documentoParaBoleta` tiene **solo dos valores: `"no"` y `"opcional"`**. No existe `"obligatorio"`
— el DNI es opcional a propósito. En canal cupón siempre viene `"no"`, porque la boleta la emite
la plataforma.

En canal cupón, además: `pago.adelantoRecibido = 0`, `pago.leyenda = "Pagado en Cuponidad"`,
`requiere.codigoCupon = true`, y un `cupon.vigenteHasta` que la web usa como fecha máxima.

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
- **Los consentimientos llegan como booleanos, no como fechas.** La marca de tiempo la pone caja
  con su propio reloj al recibirlos: esa fecha es la prueba legal y no puede depender del reloj
  del celular del cliente.
- `idioma` es el que eligió la persona en la página. Guardarlo en `clientes.idioma` para que la
  próxima ficha abra ya en ese idioma.
- Caja normaliza `telefono` a E.164 con el país recibido.

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
    "moneda": "PEN", "adelantoRecibido": 10.0, "saldo": 65.0
  }
}
```

El `.ics` lo genera caja, con `America/Lima` explícito, para que la lógica de zona horaria viva
en un solo sitio.

### Errores

Caja manda **solo un código legible por máquina**: `{ "error": "cupon_ya_usado", "mensaje": "..." }`.
Los textos que ve el cliente son de la web, en español e inglés. **Caja no traduce ni escribe
copy** — `mensaje` es solo un respaldo por si la web recibe un código que no conoce.

| Código | HTTP | Cuándo |
|---|---|---|
| `token_no_existe` | 404 | El token no está en `citas_reservadas` |
| `token_vencido` | 410 | Pasó `token_expira` |
| `ficha_ya_completa` | 410 | `estado_ficha = completa` |
| `cupon_ya_usado` | 409 | Choca con la restricción única de `cupones_convenios` |
| `validacion` | 422 | Error de campo |

**Toda la validación se repite en el servidor.** Lo que valida la web es comodidad para el
cliente; lo que decide es caja.

## 7. Seguridad del token

Ese token es lo único que protege una ficha de salud, así que:

- **Largo y aleatorio.** En un plan anterior propuse 6 caracteres legibles, y estaba pensado para
  que alguien lo dictara. Nadie lo dicta: el cliente toca un enlace. Que sea largo no le cuesta
  nada a nadie.
- **Que expire** con `token_expira`, después de la fecha de la cita.
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
