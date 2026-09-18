import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../sql/037_convenio_cobertura_guard_v2.sql", import.meta.url);

async function source() {
  return readFile(migrationUrl, "utf8");
}

test("convenio V2 debe pertenecer a la misma reserva", async () => {
  const sql = await source();
  assert.match(sql, /v_mov\.source_id is distinct from v_convenio\.reserva_id/i);
  assert.match(sql, /CONVENIO_NO_PERTENECE_A_RESERVA/i);
});

test("convenio V2 valida plataforma, sede y monto", async () => {
  const sql = await source();
  for (const token of [
    "CONVENIO_PLATAFORMA_NO_COINCIDE",
    "CONVENIO_MONTO_NO_COINCIDE",
    "CONVENIO_SEDE_NO_COINCIDE",
  ]) assert.match(sql, new RegExp(token, "i"));
});

test("convenio V2 no puede reutilizarse y se marca canjeado", async () => {
  const sql = await source();
  assert.match(sql, /CONVENIO_YA_CANJEADO/i);
  assert.match(sql, /set estado='canjeado'/i);
  assert.match(sql, /after insert[\s\S]*caja_atencion_coberturas/i);
});

test("guard de convenio queda server-only", async () => {
  const sql = await source();
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
  assert.match(sql, /revoke all on function public\.caja_validar_cobertura_convenio_v2\(\) from public, anon, authenticated/i);
  assert.match(sql, /to service_role/i);
});
