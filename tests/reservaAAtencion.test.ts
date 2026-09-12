import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la migración 022 mantiene identidad, pago e idempotencia server-only", async () => {
  const sql = await readFile(new URL("../sql/022_reserva_a_atencion.sql", import.meta.url), "utf8");
  for (const token of [
    "security definer",
    "set search_path = public, pg_temp",
    "for update",
    "RESERVA_MOVIMIENTO_NO_RELACIONADOS",
    "MOVIMIENTO_LEDGER_DESCUADRADO",
    "REQUEST_ID_PAYLOAD_CONFLICTO",
    "EXTRAS_NO_SOPORTADOS_SIN_MODELO_AUDITABLE",
    "SALDO_ATENCION_APP",
    "America/Lima",
    "ATENCION_APP",
    "EN_ATENCION",
    "ATENDIDA_APP",
    "grant execute on function public.iniciar_o_cerrar_atencion_reservada_v1(jsonb)",
  ]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  assert.doesNotMatch(sql, /insert into public\.(caja_movimientos|citas_reservadas|clientes|caja_atencion_detalle)/i);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
});

test("el harness 022 cubre los casos obligatorios y revierte", async () => {
  const harness = await readFile(new URL("../sql/tests/022_reserva_a_atencion_rollback.sql", import.meta.url), "utf8");
  for (const token of ["CASE_A", "CASE_B", "CASE_C", "CASE_D", "CASE_E", "CASE_F", "CASE_G", "CASE_H", "CASE_I", "CASE_J", "CASE_K", "rollback;"]) {
    assert.match(harness, new RegExp(token, "i"));
  }
});

test("Citas de hoy integra un flujo contextual y no reutiliza Nueva atención", async () => {
  const [today, action, form] = await Promise.all([
    readFile(new URL("../app/citas-hoy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/atencion-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/citas-hoy/[movimiento_id]/atencion/AtencionReservadaForm.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(today, /Iniciar atención/);
  assert.match(today, /reservaRelacionada/);
  assert.match(action, /iniciar_o_cerrar_atencion_reservada_v1/);
  assert.match(action, /extras: \[\]/);
  assert.match(form, /Pagado antes/);
  assert.match(form, /Saldo después/);
  assert.doesNotMatch(action, /nueva-atencion/);
});
