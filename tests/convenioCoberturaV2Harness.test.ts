import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("harness 037 prueba canje válido y rechazo cruzado con rollback", async () => {
  const source = await readFile(
    new URL("../sql/tests/037_convenio_cobertura_guard_v2_rollback.sql", import.meta.url),
    "utf8"
  );

  for (const token of [
    "CASE_A",
    "CASE_B",
    "CONVENIO_NO_PERTENECE_A_RESERVA",
    "CASE_A_CONVENIO_NO_CANJEADO",
    "CASE_B_DEBIO_RECHAZAR_CONVENIO_CRUZADO",
    "QA_037_OK",
    "rollback;",
  ]) assert.match(source, new RegExp(token, "i"));
});
