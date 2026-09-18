import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("041 conecta ficha completa con outbox sin tocar Google directamente", async () => {
  const sql = await readFile(
    new URL("../sql/041_ficha_google_contacts_outbox.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /caja_contact_sync_enqueue_cliente_v1/);
  assert.match(sql, /trg_citas_reservadas_contact_sync_on_ficha_complete_v1/);
  assert.match(sql, /after update of estado_ficha on public\.citas_reservadas/i);
  assert.match(sql, /new\.estado_ficha = 'completa'/);
  assert.match(sql, /old\.estado_ficha is distinct from 'completa'/);
  assert.match(sql, /v_outbox\.payload_hash is distinct from v_hash/);
  assert.match(sql, /processing_token = null/);
  assert.match(sql, /v_outbox\.estado in \('FAILED', 'DEAD', 'SKIPPED'\)/);
  assert.match(sql, /PENDING \/ PROCESSING \/ SUCCEEDED con el mismo payload no se toca/);
  assert.doesNotMatch(sql, /people\.googleapis\.com/i);
});
