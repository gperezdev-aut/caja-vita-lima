import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("Preparar cita ofrece Cupón / Beneficio antes de pedir cliente", () => {
  const entry = read("app/preparar-cita/PrepararCitaEntry.tsx");
  const typeStep = read("app/preparar-cita/components/AppointmentTypeStep.tsx");
  assert.match(typeStep, /value: "benefit"/);
  assert.match(typeStep, /Cupón \/ Beneficio/);
  assert.match(entry, /PrepararConvenioForm/);
});

test("el operador no escribe código ni pago en el flujo de convenio", () => {
  const form = read("app/preparar-cita/PrepararConvenioForm.tsx");
  assert.doesNotMatch(form, /name="codigo/i);
  assert.doesNotMatch(form, /monto_pagado|metodo_pago|numero_operacion/);
  assert.match(form, /El código lo completa el cliente en la página web/);
  assert.match(form, /Pago en Caja/);
  assert.match(form, /No corresponde/);
});

test("la reserva de convenio genera ficha web y usa RPC dedicada", () => {
  const actions = read("app/preparar-cita/actions.ts");
  assert.match(actions, /preparar_ficha_convenio_v1/);
  assert.match(actions, /https:\/\/vitalimaspa\.com\/cita\//);
  assert.match(actions, /No se registró ningún pago/);
});

test("la migración no inserta pagos al preparar convenio", () => {
  const sql = read("sql/042_cupones_convenios_operacion.sql");
  assert.match(sql, /create or replace function public\.preparar_ficha_convenio_v1/);
  const preparar = sql.split("create or replace function public.caja_sync_estado_convenio_cita_v1")[0];
  assert.doesNotMatch(preparar, /insert\s+into\s+public\.caja_pagos/i);
  assert.match(preparar, /'Esperando ficha'/);
  assert.match(preparar, /true, null, 'es'/);
});


test("el paso Confirmar no genera el enlace hasta un clic explícito", () => {
  const form = read("app/preparar-cita/PrepararConvenioForm.tsx");
  assert.match(form, /submitArmedRef/);
  assert.match(form, /requestSubmit\(\)/);
  assert.match(form, /if \(!submitArmedRef\.current\)/);
  assert.match(form, /event\.preventDefault\(\)/);
  assert.match(form, /type="button"[\s\S]*Confirmar y generar enlace/);
  assert.doesNotMatch(form, /type="submit" className="primaryButton"[\s\S]*Generar enlace de ficha/);
});
