import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("VITA_OPERACION puede ver el módulo Cupones", () => {
  const auth = read("lib/auth.ts");
  assert.match(auth, /\| "cupones"/);
  assert.match(auth, /key: "cupones", label: "Cupones", href: "\/cupones"/);
  const vitaBlock = auth.split("VITA_OPERACION: [")[1]?.split("],")[0] ?? "";
  assert.match(vitaBlock, /"cupones"/);
});

test("Cupones usa reservas de Cuponidad y Bee como bandeja completa", () => {
  const page = read("app/cupones/page.tsx");
  assert.match(page, /canal=in\.\(cuponidad,bee\)/);
  assert.match(page, /Esperando ficha/);
  assert.match(page, /Cupón registrado/);
  assert.match(page, /Verificado/);
  assert.match(page, /Canjeado/);
});

test("validar cupón asigna servicio y monto reconocido sin crear un pago", () => {
  const sql = read("sql/042_cupones_convenios_operacion.sql");
  assert.match(sql, /caja_validar_cupon_convenio_v1/);
  assert.match(sql, /caja_catalog_active_services_read_v1/);
  assert.match(sql, /monto_reconocido = round\(p_monto_reconocido, 2\)/);
  assert.match(sql, /estado = 'verificado'/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.caja_pagos/i);
});

test("la atención recibe el convenio verificado automáticamente", () => {
  const page = read("app/citas-hoy/[movimiento_id]/atencion/page.tsx");
  const form = read("app/citas-hoy/[movimiento_id]/atencion/AtencionReservadaForm.tsx");
  assert.match(page, /convenioInicial=/);
  assert.match(page, /Cupón verificado/);
  assert.match(form, /convenioBloqueado/);
  assert.match(form, /no genera ingreso nuevo/);
});

test("la ficha pública expone el proveedor elegido en Caja", () => {
  const route = read("app/api/publico/ficha/[token]/route.ts");
  assert.match(route, /proveedor: esCuponidad \? "Cuponidad" : "Bee Beneficios"/);
  assert.match(route, /codigoCupon\?: string/);
});


test("un convenio pendiente no genera ICS con duración inventada", () => {
  const route = read("app/api/publico/ficha/[token]/ics/route.ts");
  assert.match(route, /const esConvenio = cita\.canal === "cuponidad" \|\| cita\.canal === "bee"/);
  assert.match(route, /esConvenio && \(!cita\.duracion_min \|\| cita\.duracion_min <= 0\)/);
  assert.match(route, /pendiente de validar antes de agregarlo al calendario/);
});


test("la ficha de convenio marca el WhatsApp como preconfirmado sin exponerlo", () => {
  const route = read("app/api/publico/ficha/[token]/route.ts");
  assert.match(route, /whatsappPreconfirmado: esConvenio && Boolean\(cita\.whatsapp\)/);
  assert.match(route, /telefonoGuardadoDesdeE164/);
  assert.doesNotMatch(route, /body\.whatsapp\s*=/);
});
