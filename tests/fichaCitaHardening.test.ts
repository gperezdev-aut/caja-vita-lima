import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FICHA_CONTRATO_VERSION,
  estadoConfirmacionPublica,
  calcularExpiracionFicha,
  evaluarEstadoToken,
  expiracionTokenFichaValida,
  identidadSincronizada,
  normalizarTelefonoE164,
  pagoVisibleCliente,
  preservarDatosCliente,
  resolverClientePorTelefono,
  resolverExpiracionFichaVigente,
  resolverReintentoPreparacion,
  precioCatalogoActivo,
  validarCatalogoSolicitado,
  validarCodigoCuponPorCanal,
  validarPagoPreparacion,
  validarPreparacionMvp,
  validarSolicitudComprobante,
} from "../lib/fichaCitaDominio.ts";
import { construirIcs } from "../lib/fichaCitaIcs.ts";

test("el contrato público tiene una versión estable", () => {
  assert.equal(FICHA_CONTRATO_VERSION, "ficha-cita-v1");
});

test("una ficha omisa conserva email, DNI y cumpleaños anteriores", () => {
  assert.equal(preservarDatosCliente("rosa@example.com", null), "rosa@example.com");
  assert.equal(preservarDatosCliente("12345678", ""), "12345678");
  assert.equal(preservarDatosCliente(14, null), 14);
  assert.equal(preservarDatosCliente(3, undefined), 3);
});

test("un consentimiento promocional falso no representa una revocación", () => {
  const anterior = "2026-01-01T10:00:00Z";
  assert.equal(preservarDatosCliente(anterior, null), anterior);
});

test("rechaza WhatsApp asociado a otro cliente y permite el propio o uno nuevo", () => {
  assert.deepEqual(resolverClientePorTelefono("CLI-1", "CLI-2", "CLI-3"), {
    ok: false, error: "telefono_asociado_otro_cliente",
  });
  assert.deepEqual(resolverClientePorTelefono("CLI-1", "CLI-1", "CLI-3"), { ok: true, clienteId: "CLI-1" });
  assert.deepEqual(resolverClientePorTelefono("CLI-1", null, "CLI-3"), { ok: true, clienteId: "CLI-1" });
});

test("cliente, cita y movimiento reciben la misma identidad", () => {
  const resultado = identidadSincronizada("CLI-1", "Rosa Quispe", "+51987654321");
  assert.deepEqual(resultado.cliente, resultado.cita);
  assert.deepEqual(resultado.cita, resultado.movimiento);
});

test("DNI crea boleta y nunca exige razón social", () => {
  assert.deepEqual(validarSolicitudComprobante({ requiere: true, tipo: "DNI", numero: "12345678" }), {
    ok: true, solicitado: true, tipoComprobante: "BOLETA", tipoDocumento: "DNI",
    numeroDocumento: "12345678", razonSocial: null,
  });
});

test("RUC crea factura con razón social", () => {
  assert.deepEqual(validarSolicitudComprobante({ requiere: true, tipo: "RUC", numero: "20123456789", razonSocial: "Vita SAC" }), {
    ok: true, solicitado: true, tipoComprobante: "FACTURA", tipoDocumento: "RUC",
    numeroDocumento: "20123456789", razonSocial: "Vita SAC",
  });
});

test("RUC sin razón social es rechazado", () => {
  assert.deepEqual(validarSolicitudComprobante({ requiere: true, tipo: "RUC", numero: "20123456789", razonSocial: "" }), {
    ok: false, error: "El RUC requiere 11 dígitos y razón social.",
  });
});

test("Cuponidad y Bee no muestran deuda del cliente", () => {
  assert.deepEqual(pagoVisibleCliente("cuponidad", 200, 0), {
    adelantoRecibido: 0, saldo: 0, leyenda: "Pago gestionado por Cuponidad",
  });
  assert.deepEqual(pagoVisibleCliente("bee", 200, 0), {
    adelantoRecibido: 0, saldo: 0, leyenda: "Pago gestionado por Bee Beneficios",
  });
});

test("el MVP rechaza convenios, promociones y gift cards en preparación", () => {
  for (const input of [
    { canal: "cuponidad", esGiftCard: false, cuponPromocional: "" },
    { canal: "bee", esGiftCard: false, cuponPromocional: "" },
    { canal: "directo", esGiftCard: true, cuponPromocional: "" },
    { canal: "directo", esGiftCard: false, cuponPromocional: "PROMO" },
    { canal: "directo", esGiftCard: true, cuponPromocional: "PROMO" },
  ]) assert.notEqual(validarPreparacionMvp(input), "");
  assert.equal(validarPreparacionMvp({ canal: "directo", esGiftCard: false, cuponPromocional: "" }), "");
});

test("request_id repetido reutiliza exactamente la reserva y el token", () => {
  const existente = { requestId: "REQ", fingerprint: "ABC", reservaId: "RES-1", token: "TOKEN-1" };
  assert.deepEqual(resolverReintentoPreparacion(existente, "REQ", "ABC"), {
    tipo: "reutilizar", reservaId: "RES-1", token: "TOKEN-1",
  });
  // Cubre el caso de respuesta perdida: el segundo intento recibe el mismo resultado.
  assert.deepEqual(resolverReintentoPreparacion(existente, "REQ", "ABC"), resolverReintentoPreparacion(existente, "REQ", "ABC"));
});

test("request_id repetido con contenido diferente produce conflicto", () => {
  const existente = { requestId: "REQ", fingerprint: "ABC", reservaId: "RES-1", token: "TOKEN-1" };
  assert.deepEqual(resolverReintentoPreparacion(existente, "REQ", "OTRO"), { tipo: "conflicto" });
});

test("el payload de prepararCitaAction acepta un token que expira exactamente al final", () => {
  const fecha = "2026-09-20";
  const hora = "16:00";
  const duracionMin = 120;
  const payloadGeneradoPorAccion = {
    fecha,
    hora,
    duracion_min: duracionMin,
    token_expira: calcularExpiracionFicha(fecha, hora, duracionMin),
  };
  assert.equal(expiracionTokenFichaValida({
    fecha: payloadGeneradoPorAccion.fecha,
    hora: payloadGeneradoPorAccion.hora,
    duracionMin: payloadGeneradoPorAccion.duracion_min,
    tokenExpira: payloadGeneradoPorAccion.token_expira,
  }), true);
  assert.equal(expiracionTokenFichaValida({
    fecha, hora, duracionMin,
    tokenExpira: calcularExpiracionFicha(fecha, hora, duracionMin - 1),
  }), false);
});

test("un enlace recién creado hoy permanece vigente con hora de Lima", () => {
  const now = Date.parse("2026-09-11T23:00:00Z"); // 6:00 p. m. en Lima
  const result = resolverExpiracionFichaVigente("2026-09-11", "19:00", 60, now);
  assert.deepEqual(result, { ok: true, tokenExpira: "2026-09-12T01:00:00.000Z" });
  assert.equal(result.ok && Date.parse(result.tokenExpira) > now, true);
  assert.equal(result.ok && evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: result.tokenExpira }, now), "vigente");
});

test("una fecha futura genera un enlace vigente", () => {
  const result = resolverExpiracionFichaVigente(
    "2026-09-12",
    "10:00",
    60,
    Date.parse("2026-09-11T23:00:00Z"),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: result.tokenExpira }, Date.parse("2026-09-11T23:00:00Z")), "vigente");
});

test("no crea un enlace si la cita de hoy realmente ya terminó", () => {
  const result = resolverExpiracionFichaVigente(
    "2026-09-11",
    "10:00",
    60,
    Date.parse("2026-09-11T18:00:00Z"), // 1:00 p. m. en Lima
  );
  assert.deepEqual(result, { ok: false });
  assert.equal(evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: "2026-09-11T16:00:00.000Z" }, Date.parse("2026-09-11T18:00:00Z")), "token_vencido");
});

test("la expiración cruza medianoche de Lima sin vencer anticipadamente", () => {
  const beforeEnd = Date.parse("2026-09-12T05:29:59Z");
  const result = resolverExpiracionFichaVigente("2026-09-11", "23:30", 60, beforeEnd);
  assert.deepEqual(result, { ok: true, tokenExpira: "2026-09-12T05:30:00.000Z" });
  assert.equal(result.ok && evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: result.tokenExpira }, beforeEnd), "vigente");
  assert.equal(resolverExpiracionFichaVigente("2026-09-11", "23:30", 60, beforeEnd + 1000).ok, false);
});

test("prepararCitaAction valida la vigencia calculada antes de invocar la RPC", async () => {
  const action = await readFile(new URL("../app/preparar-cita/actions.ts", import.meta.url), "utf8");
  const validation = action.indexOf("resolverExpiracionFichaVigente(fecha, hora, duracionMin)");
  const rpc = action.indexOf("const rpc = await supabaseRpc");
  assert.ok(validation > 0 && rpc > validation);
  assert.match(action, /La hora seleccionada ya terminó/);
});

test("un código de convenio solo se admite en Cuponidad o Bee", () => {
  assert.equal(validarCodigoCuponPorCanal("cuponidad", ""), "Falta el código de cupón.");
  assert.equal(validarCodigoCuponPorCanal("bee", "BEE-123"), "");
  assert.equal(validarCodigoCuponPorCanal("directo", "PROMO-123"), "Esta cita directa no admite código de cupón.");
  assert.equal(validarCodigoCuponPorCanal("directo", ""), "");
});

test("el precio usa price_pen y solo usa price como respaldo si falta", () => {
  assert.equal(precioCatalogoActivo("120", "90"), 120);
  assert.equal(precioCatalogoActivo(null, "90"), 90);
  assert.ok(Number.isNaN(precioCatalogoActivo("precio inválido", "90")));
});

test("pagos inválidos se rechazan antes de invocar la RPC", () => {
  const base = {
    adelantoRequerido: 10,
    total: 100,
    metodoPago: "EFECTIVO",
    numeroOperacion: "",
    metodosPermitidos: ["EFECTIVO", "YAPE"],
  };
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: -1 }), "El monto pagado no puede ser negativo.");
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 9 }), "Registra al menos S/10.00 antes de generar el enlace.");
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 101 }), "El monto pagado no puede superar el total de la cita.");
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 10, metodoPago: "" }), "El método de pago es obligatorio.");
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 10, metodoPago: "PLIN" }), "El método de pago no está configurado o no está permitido.");
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 10, metodoPago: "YAPE" }), "El número de operación es obligatorio para pagos no efectivos.");
  assert.equal(validarPagoPreparacion({ ...base, montoPagado: 10 }), "");
});

test("la ruta pública reutiliza la validación de código por canal", async () => {
  const route = await readFile(new URL("../app/api/publico/ficha/[token]/route.ts", import.meta.url), "utf8");
  assert.match(route, /validarCodigoCuponPorCanal\(canal, codigoCupon\)/);
});

test("la migración protege comprobantes y no permite cupón directo", async () => {
  const migration = await readFile(new URL("../sql/016_ficha_cita_hardening.sql", import.meta.url), "utf8");
  assert.match(migration, /revoke all on table public\.solicitudes_comprobante from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.solicitudes_comprobante to service_role/i);
  assert.match(migration, /CODIGO_CONVENIO_NO_PERMITIDO_DIRECTO/);
  assert.match(migration, /v_codigo_cupon <> '' and v_cita\.canal in \('cuponidad', 'bee'\)/);
});

test("la RPC comparte respaldo de precio y regla de expiración con la aplicación", async () => {
  const migration = await readFile(new URL("../sql/016_ficha_cita_hardening.sql", import.meta.url), "utf8");
  assert.match(migration, /to_jsonb\(c\)->>'price_pen'/);
  assert.match(migration, /to_jsonb\(c\)->>'price'/);
  assert.match(migration, /v_token_expira < \(\(v_fecha \+ v_hora\) \+ make_interval\(mins => v_duracion\)\)/);
});

test("motivo de confirmación distingue domicilio, convenio y cita confirmada", () => {
  assert.deepEqual(estadoConfirmacionPublica({ requiereConfirmacion: true, tipoAtencion: "domicilio", canal: "directo" }), {
    confirmacionManual: true, motivoConfirmacion: "domicilio",
  });
  assert.deepEqual(estadoConfirmacionPublica({ requiereConfirmacion: true, tipoAtencion: "sede", canal: "bee" }), {
    confirmacionManual: true, motivoConfirmacion: "convenio",
  });
  assert.deepEqual(estadoConfirmacionPublica({ requiereConfirmacion: true, confirmadoEn: "2026-09-08T10:00:00Z", tipoAtencion: "domicilio" }), {
    confirmacionManual: false, motivoConfirmacion: null,
  });
  assert.deepEqual(estadoConfirmacionPublica({ requiereConfirmacion: false, tipoAtencion: "sede", canal: "directo" }), {
    confirmacionManual: false, motivoConfirmacion: null,
  });
});

test("ICS distingue tentative y confirmed y pliega líneas a 75 octetos", () => {
  const base = { uid: "RES-1@vita", fecha: "2026-09-20", hora: "16:00", duracionMin: 60,
    resumen: "Atención a domicilio pendiente", ubicacion: `Miraflores, ${"á".repeat(80)}`,
    ahora: new Date("2026-09-08T12:00:00Z") };
  const tentative = construirIcs({ ...base, estado: "TENTATIVE" });
  const confirmed = construirIcs({ ...base, estado: "CONFIRMED" });
  assert.match(tentative, /STATUS:TENTATIVE/);
  assert.match(confirmed, /STATUS:CONFIRMED/);
  for (const line of tentative.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
});

test("normaliza Perú, EE. UU., Canadá, España y Japón y rechaza inconsistencias", () => {
  assert.deepEqual(normalizarTelefonoE164("987654321", "PE"), { ok: true, e164: "+51987654321", pais: "PE" });
  assert.deepEqual(normalizarTelefonoE164("51987654321", "PE"), { ok: true, e164: "+51987654321", pais: "PE" });
  assert.deepEqual(normalizarTelefonoE164("4155552671", "US"), { ok: true, e164: "+14155552671", pais: "US" });
  assert.deepEqual(normalizarTelefonoE164("4165550123", "CA"), { ok: true, e164: "+14165550123", pais: "CA" });
  assert.deepEqual(normalizarTelefonoE164("612345678", "ES"), { ok: true, e164: "+34612345678", pais: "ES" });
  assert.deepEqual(normalizarTelefonoE164("09012345678", "JP"), { ok: true, e164: "+819012345678", pais: "JP" });
  assert.deepEqual(normalizarTelefonoE164("+34612345678", "PE"), { ok: false });
  assert.deepEqual(normalizarTelefonoE164("123", "PE"), { ok: false });
});

test("normaliza formatos pegados del operador sin duplicar prefijos", () => {
  assert.deepEqual(normalizarTelefonoE164("987 654-321", "PE"), { ok: true, e164: "+51987654321", pais: "PE" });
  assert.deepEqual(normalizarTelefonoE164("+51 987 654 321", "PE"), { ok: true, e164: "+51987654321", pais: "PE" });
  assert.deepEqual(normalizarTelefonoE164("+1 (305) 555-1234", "US"), { ok: true, e164: "+13055551234", pais: "US" });
  const peruInternacional = normalizarTelefonoE164("+51 987 654 321", "PE");
  assert.equal(peruInternacional.ok, true);
  if (peruInternacional.ok) assert.notEqual(peruInternacional.e164, "+5151987654321");
});

test("catálogo rechaza código inexistente, duplicado o económicamente inválido", () => {
  const valido = { codigo: "MAS-1H", nombre: "Masaje", precio: 80, duracion_min: 60 };
  assert.equal(validarCatalogoSolicitado(["MAS-1H"], [valido]).ok, true);
  assert.equal(validarCatalogoSolicitado(["NO-EXISTE"], [valido]).ok, false);
  assert.equal(validarCatalogoSolicitado(["MAS-1H"], [valido, { ...valido }]).ok, false);
  assert.equal(validarCatalogoSolicitado(["MAS-1H"], [{ ...valido, precio: 0 }]).ok, false);
});
