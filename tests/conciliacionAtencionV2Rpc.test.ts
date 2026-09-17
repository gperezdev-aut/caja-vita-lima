import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sqlUrl = new URL("../sql/035_conciliar_atencion_v2.sql", import.meta.url);

async function sql() {
  return readFile(sqlUrl, "utf8");
}

test("RPC V2 conserva idempotencia y seguridad server-only", async () => {
  const source = await sql();
  for (const token of [
    "create or replace function public.conciliar_atencion_v2",
    "security definer",
    "set search_path = public, pg_temp",
    "pg_advisory_xact_lock",
    "REQUEST_ID_PAYLOAD_CONFLICTO",
    "for update",
    "MOVIMIENTO_LEDGER_DESCUADRADO",
    "caja_conciliacion_atencion_requests",
    "grant execute on function public.conciliar_atencion_v2(jsonb) to service_role",
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  assert.match(source, /revoke all on function public\.conciliar_atencion_v2\(jsonb\) from public, anon, authenticated/i);
});

test("cada pago real se registra por separado en caja_pagos", async () => {
  const source = await sql();
  assert.match(source, /for v_item in select value from jsonb_array_elements\(v_pagos\)[\s\S]*?insert into public\.caja_pagos/i);
  assert.match(source, /SALDO_ATENCION_V2/i);
  assert.match(source, /PAGOS_SUPERAN_PENDIENTE/i);
  assert.match(source, /NUMERO_OPERACION_REQUERIDO/i);
});

test("propinas viven fuera del ledger de ingresos Vita Lima", async () => {
  const source = await sql();
  const tipBlock = source.match(/-- Propina:[\s\S]*?v_estado_movimiento :=/i)?.[0] ?? "";
  assert.match(tipBlock, /insert into public\.caja_propinas/i);
  assert.match(tipBlock, /insert into public\.caja_propina_distribucion/i);
  assert.doesNotMatch(tipBlock, /insert into public\.caja_pagos/i);
  assert.match(tipBlock, /PROPINA_DISTRIBUCION_NO_CUADRA/i);
  assert.match(tipBlock, /terapistas[\s\S]*estado='ACTIVA'/i);
});

test("Gift Card se canjea en la misma transacción sin crear ingreso nuevo", async () => {
  const source = await sql();
  assert.match(source, /GIFT_CARD_COBERTURA_REQUERIDA/i);
  assert.match(source, /insert into public\.gift_card_usos/i);
  assert.match(source, /update public\.gift_card_reservas[\s\S]*estado='CANJEADA'/i);
  assert.match(source, /insert into public\.gift_card_eventos/i);
  assert.match(source, /CONCILIACION_ATENCION_V2/i);
});

test("Bee y Cuponidad son coberturas, no métodos de pago", async () => {
  const source = await sql();
  assert.match(source, /CONVENIO_BEE/i);
  assert.match(source, /CONVENIO_CUPONIDAD/i);
  assert.match(source, /public\.cupones_convenios/i);
  assert.match(source, /CONVENIO_MONTO_NO_COINCIDE/i);
  assert.doesNotMatch(source, /v_metodo\s*:?=\s*['\"](?:BEE|CUPONIDAD)/i);
});

test("extras y descuentos recalculan total antes de coberturas y pagos", async () => {
  const source = await sql();
  const posExtras = source.indexOf("v_extra_nuevo := v_extra_nuevo + v_monto");
  const posAjustes = source.indexOf("v_ajuste_nuevo := v_ajuste_nuevo + v_monto");
  const posTotal = source.indexOf("v_total_cobrar := round");
  const posCobertura = source.indexOf("-- Coberturas nuevas del request.");
  const posPagos = source.indexOf("-- Pagos reales de Vita Lima.");
  assert.ok(posExtras >= 0 && posAjustes >= 0 && posTotal > posExtras && posTotal > posAjustes);
  assert.ok(posCobertura > posTotal && posPagos > posCobertura);
  assert.match(source, /AJUSTES_SUPERAN_TOTAL/i);
  assert.match(source, /COBERTURAS_O_PAGOS_SUPERAN_TOTAL/i);
});

test("V1 permanece intacto y V2 usa su propio contrato", async () => {
  const source = await sql();
  assert.doesNotMatch(source, /create or replace function public\.iniciar_o_cerrar_atencion_reservada_v1/i);
  assert.doesNotMatch(source, /create or replace function public\.iniciar_o_cerrar_atencion_reservada_gift_card_v1/i);
});
