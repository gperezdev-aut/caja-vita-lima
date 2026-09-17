import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("harness 035 cubre casuísticas reales y siempre revierte", async () => {
  const source = await readFile(
    new URL("../sql/tests/035_conciliar_atencion_v2_rollback.sql", import.meta.url),
    "utf8"
  );

  for (const token of [
    "CASE_A",
    "CASE_B",
    "CASE_C",
    "CASE_D",
    "CASE_E",
    "EFECTIVO",
    "YAPE",
    "MINUTOS_EXTRA",
    "caja_propinas",
    "DESCUENTO",
    "CONVENIO_BEE",
    "QA_035_OK",
    "rollback;",
  ]) {
    assert.match(source, new RegExp(token, "i"));
  }
});

test("harness 035 prueba que propina y convenio no crean ingresos falsos", async () => {
  const source = await readFile(
    new URL("../sql/tests/035_conciliar_atencion_v2_rollback.sql", import.meta.url),
    "utf8"
  );

  assert.match(source, /CASE_C_PROPINA_CONTAMINO_CAJA_PAGOS/i);
  assert.match(source, /CASE_C_PROPINA_NO_REGISTRADA/i);
  assert.match(source, /CASE_E_CONVENIO_CREO_PAGO_FALSO/i);
  assert.match(source, /CASE_A_REPLAY_NO_IDEMPOTENTE/i);
  assert.match(source, /CASE_A_REPLAY_DUPLICO_PAGOS/i);
});
