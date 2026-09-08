import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAdelantoRequerido,
  evaluarEstadoToken,
  horarioDentroDeSede,
  normalizarTelefonoE164,
  pagoHabilitaToken,
  requiereConfirmacion,
  validarConfiguracionApiPublica,
} from "../lib/fichaCitaDominio.ts";
import { secretoCajaValido } from "../lib/fichaCitaSeguridad.ts";

test("una persona requiere S/10", () => {
  assert.equal(calcularAdelantoRequerido({ canal: "directo", personas: 1, montoTotal: 80 }), 10);
});

test("dos personas requieren 50% del total", () => {
  assert.equal(calcularAdelantoRequerido({ canal: "directo", personas: 2, montoTotal: 150 }), 75);
});

test("gift card requiere 100%", () => {
  assert.equal(calcularAdelantoRequerido({ canal: "directo", personas: 1, montoTotal: 90, esGiftCard: true }), 90);
});

test("cupón promocional con teléfono peruano conserva la regla normal", () => {
  const phone = normalizarTelefonoE164("987 654 321", "PE");
  assert.deepEqual(phone, { ok: true, e164: "+51987654321", pais: "PE" });
  assert.equal(calcularAdelantoRequerido({ canal: "directo", personas: 1, montoTotal: 70 }), 10);
});

test("cupón promocional con teléfono extranjero conserva la regla normal", () => {
  const phone = normalizarTelefonoE164("415 555 2671", "US");
  assert.deepEqual(phone, { ok: true, e164: "+14155552671", pais: "US" });
  assert.equal(calcularAdelantoRequerido({ canal: "directo", personas: 2, montoTotal: 120 }), 60);
});

test("Cuponidad y Bee usan adelanto cero y confirmación", () => {
  for (const canal of ["cuponidad", "bee"] as const) {
    assert.equal(calcularAdelantoRequerido({ canal, personas: 2, montoTotal: 200 }), 0);
    assert.equal(requiereConfirmacion(canal), true);
  }
});

test("acepta un teléfono extranjero E.164 válido", () => {
  assert.deepEqual(normalizarTelefonoE164("+34 612 34 56 78", "ES"), {
    ok: true, e164: "+34612345678", pais: "ES",
  });
});

test("rechaza una hora que no cabe dentro del rango de la sede", () => {
  assert.equal(horarioDentroDeSede("14:30", 60, "15:00", "20:00"), false);
  assert.equal(horarioDentroDeSede("19:30", 60, "15:00", "20:00"), false);
  assert.equal(horarioDentroDeSede("19:00", 60, "15:00", "20:00"), true);
});

test("no habilita token sin cubrir el pago requerido", () => {
  assert.equal(pagoHabilitaToken(9.99, 10), false);
  assert.equal(pagoHabilitaToken(10, 10), true);
});

test("secreto ausente o incorrecto no autentica", () => {
  assert.equal(secretoCajaValido("cualquiera", ""), false);
  assert.equal(secretoCajaValido("incorrecto", "correcto"), false);
  assert.equal(secretoCajaValido("correcto", "correcto"), true);
});

test("distingue token inexistente, vencido y ya completado", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  assert.equal(evaluarEstadoToken(null, now), "token_no_existe");
  assert.equal(evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: "2026-09-08T11:00:00Z" }, now), "token_vencido");
  assert.equal(evaluarEstadoToken({ estado_ficha: "completa", token_expira: "2026-09-09T11:00:00Z" }, now), "ficha_ya_completa");
});

test("producción detecta CAJA_API_URL y CAJA_API_SECRET ausentes", () => {
  const result = validarConfiguracionApiPublica({}, ["CAJA_API_URL", "CAJA_API_SECRET"]);
  assert.deepEqual(result, { ok: false, faltantes: ["CAJA_API_URL", "CAJA_API_SECRET"] });
});

