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

test("el catálogo de convenios separa servicio de cálculos económicos", () => {
  const sql = read("sql/043_catalogo_convenios_servicios.sql");
  const form = read("app/cupones/CuponValidationForm.tsx");
  const actions = read("app/cupones/actions.ts");

  assert.match(sql, /create table if not exists public\.caja_convenio_beneficios/);
  assert.match(sql, /caja_asignar_beneficio_convenio_v1/);
  assert.match(sql, /CUP-MASAJE-3S/);
  assert.match(sql, /BEE-PACK-VITA/);
  assert.match(sql, /BEE-PACK-RENOVA/);
  assert.match(sql, /economia_pendiente/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.caja_pagos/i);

  assert.match(actions, /caja_asignar_beneficio_convenio_v1/);
  assert.doesNotMatch(actions, /p_monto_reconocido/);
  assert.doesNotMatch(form, /monto_reconocido/);
  assert.match(form, /No se calcula monto, comisión, fee ni cobertura/);
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


test("el convenio mantiene WhatsApp del lado cliente y recupera recurrente por E164", () => {
  const route = read("app/api/publico/ficha/[token]/identificar/route.ts");
  const shared = read("app/api/publico/ficha/_lib.ts");
  assert.match(route, /cargarClientePorWhatsappE164\(normalizado\.e164\)/);
  assert.match(route, /construirFichaRecurrente/);
  assert.match(shared, /whatsapp_e164=eq\.\$\{encodeURIComponent\(whatsappE164\)\}/);
});


test("Cuponidad y Bee muestran solo beneficios propios del convenio", () => {
  const page = read("app/cupones/page.tsx");
  const form = read("app/cupones/CuponValidationForm.tsx");
  assert.match(page, /caja_convenio_beneficios/);
  assert.match(page, /provider=\{provider\}/);
  assert.match(form, /benefits\.filter\(\(benefit\) => benefit\.provider === provider\)/);
  assert.doesNotMatch(page, /leerCatalogoPrepararCita/);
});

test("la opción multisesión se guarda sin implementar todavía el consumo", () => {
  const sql = read("sql/043_catalogo_convenios_servicios.sql");
  assert.match(sql, /'CUP-MASAJE-3S'/);
  assert.match(sql, /30, 3, 'San Borja'/);
  assert.match(sql, /control de consumo pendiente de implementación/);
  assert.match(sql, /sesiones_total = v_beneficio\.sesiones_total/);
  assert.doesNotMatch(sql, /sesiones_usadas/);
});
