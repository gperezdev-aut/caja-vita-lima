import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularAdelantoRequerido,
  calcularCitaDomicilio,
  coincideEconomiaDomicilio,
  describirAtencionDomicilio,
  evaluarEstadoToken,
  horarioDentroDeSede,
  normalizarTelefonoE164,
  pagoHabilitaToken,
  requiereConfirmacion,
  tipoAtencionDesdeServicios,
  validarDatosDomicilio,
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

function domicilio(...codigos: ("DOM-1H" | "DOM-2H")[]) {
  return calcularCitaDomicilio(codigos.map((codigo) => ({
    codigo,
    precio: codigo === "DOM-1H" ? 120 : 230,
    duracion_min: codigo === "DOM-1H" ? 60 : 120,
  })));
}

test("DOM-1H suma movilidad única y requiere 50%", () => {
  assert.deepEqual(domicilio("DOM-1H"), {
    ok: true, subtotalServicios: 120, movilidad: 15, total: 135, adelantoRequerido: 67.5, duracionMin: 60,
  });
});

test("DOM-2H suma movilidad única y requiere 50%", () => {
  assert.deepEqual(domicilio("DOM-2H"), {
    ok: true, subtotalServicios: 230, movilidad: 15, total: 245, adelantoRequerido: 122.5, duracionMin: 120,
  });
});

test("dos personas a domicilio comparten una sola movilidad y la mayor duración", () => {
  const casos = [
    { codigos: ["DOM-1H", "DOM-1H"] as const, total: 255, adelanto: 127.5, duracion: 60 },
    { codigos: ["DOM-1H", "DOM-2H"] as const, total: 365, adelanto: 182.5, duracion: 120 },
    { codigos: ["DOM-2H", "DOM-2H"] as const, total: 475, adelanto: 237.5, duracion: 120 },
  ];
  for (const caso of casos) {
    const calculo = domicilio(...caso.codigos);
    assert.equal(calculo.ok, true);
    if (!calculo.ok) continue;
    assert.equal(calculo.movilidad, 15);
    assert.equal(calculo.total, caso.total);
    assert.equal(calculo.adelantoRequerido, caso.adelanto);
    assert.equal(calculo.duracionMin, caso.duracion);
  }
});

test("domicilio rechaza servicios mezclados y datos de cobertura incompletos", () => {
  assert.equal(tipoAtencionDesdeServicios(["DOM-1H", "MAS-1H"]), "mezclado");
  assert.equal(validarDatosDomicilio({ sedeOperativa: "Miraflores", distrito: "", direccion: "Calle 1" }, ["Miraflores", "San Borja"]), "El distrito del domicilio es obligatorio.");
  assert.equal(validarDatosDomicilio({ sedeOperativa: "Miraflores", distrito: "Miraflores", direccion: "" }, ["Miraflores", "San Borja"]), "La dirección del domicilio es obligatoria.");
  assert.equal(validarDatosDomicilio({ sedeOperativa: "Otra", distrito: "Miraflores", direccion: "Calle 1" }, ["Miraflores", "San Borja"]), "La sede operativa no es válida.");
});

test("el servidor no acepta movilidad ni total manipulados y presencial conserva movilidad cero", () => {
  const calculo = domicilio("DOM-1H");
  assert.equal(calculo.ok, true);
  if (!calculo.ok) return;
  assert.equal(coincideEconomiaDomicilio(calculo, 135, 15), true);
  assert.equal(coincideEconomiaDomicilio(calculo, 120, 0), false);
  assert.equal(tipoAtencionDesdeServicios(["MAS-1H"]), "sede");
  assert.equal(calcularAdelantoRequerido({ canal: "directo", personas: 1, montoTotal: 120 }), 10);
});

test("domicilio exige confirmación y el mensaje no expone la sede operativa", () => {
  assert.equal(requiereConfirmacion("directo", true), true);
  assert.equal(
    describirAtencionDomicilio({ distrito: "Miraflores", direccion: "Av. Ejemplo 123", referencia: "Portón negro" }),
    "Atención a domicilio · Miraflores · Av. Ejemplo 123 · Referencia: Portón negro"
  );
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
