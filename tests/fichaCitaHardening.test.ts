import test from "node:test";
import assert from "node:assert/strict";
import {
  FICHA_CONTRATO_VERSION,
  estadoConfirmacionPublica,
  identidadSincronizada,
  normalizarTelefonoE164,
  pagoVisibleCliente,
  preservarDatosCliente,
  resolverClientePorTelefono,
  resolverReintentoPreparacion,
  validarCatalogoSolicitado,
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

test("catálogo rechaza código inexistente, duplicado o económicamente inválido", () => {
  const valido = { codigo: "MAS-1H", nombre: "Masaje", precio: 80, duracion_min: 60 };
  assert.equal(validarCatalogoSolicitado(["MAS-1H"], [valido]).ok, true);
  assert.equal(validarCatalogoSolicitado(["NO-EXISTE"], [valido]).ok, false);
  assert.equal(validarCatalogoSolicitado(["MAS-1H"], [valido, { ...valido }]).ok, false);
  assert.equal(validarCatalogoSolicitado(["MAS-1H"], [{ ...valido, precio: 0 }]).ok, false);
});
