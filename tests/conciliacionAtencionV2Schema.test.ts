import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migración 034 crea las entidades auditables de la V2", async () => {
  const sql = await readFile(new URL("../sql/034_conciliacion_atencion_v2.sql", import.meta.url), "utf8");
  for (const token of [
    "caja_atencion_extras",
    "caja_atencion_ajustes",
    "caja_atencion_coberturas",
    "caja_propinas",
    "caja_propina_distribucion",
    "caja_conciliacion_atencion_requests",
    "MINUTOS_EXTRA",
    "CONVENIO_BEE",
    "CONVENIO_CUPONIDAD",
    "GIFT_CARD",
    "DESCUENTO",
    "CORTESIA",
    "AJUSTE_PRECIO",
  ]) {
    assert.match(sql, new RegExp(token, "i"));
  }
});

test("propinas no usan caja_pagos ni caja_salidas como almacenamiento", async () => {
  const sql = await readFile(new URL("../sql/034_conciliacion_atencion_v2.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /insert\s+into\s+public\.caja_pagos/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.caja_salidas/i);
  assert.match(sql, /Dinero recibido por cuenta de terapistas/i);
});

test("modelo V2 queda restringido a service_role", async () => {
  const sql = await readFile(new URL("../sql/034_conciliacion_atencion_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /to service_role/i);
});

test("distribución de propina enlaza al maestro de terapistas", async () => {
  const sql = await readFile(new URL("../sql/034_conciliacion_atencion_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /terapista_id uuid not null references public\.terapistas\(terapista_id\)/i);
  assert.match(sql, /unique \(propina_id, terapista_id\)/i);
});

test("extras conservan trazabilidad de monto y responsable", async () => {
  const sql = await readFile(new URL("../sql/034_conciliacion_atencion_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /monto_total = round\(cantidad \* monto_unitario, 2\)/i);
  assert.match(sql, /responsable text not null/i);
  assert.match(sql, /request_id uuid not null/i);
});

test("migración 036 amplía cierre sin reescribir históricos", async () => {
  const sql = await readFile(new URL("../sql/036_cierre_caja_propinas_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.caja_cierres/i);
  assert.match(sql, /total_propinas numeric\(12,2\) not null default 0/i);
  assert.match(sql, /total_procesado numeric\(12,2\) not null default 0/i);
  assert.match(sql, /propinas_por_metodo jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /dinero_procesado_por_metodo jsonb not null default '\{\}'::jsonb/i);
  assert.doesNotMatch(sql, /update public\.caja_cierres/i);
  assert.doesNotMatch(sql, /delete from public\.caja_cierres/i);
});
