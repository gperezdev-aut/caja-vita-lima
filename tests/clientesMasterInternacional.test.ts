import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la lista CRM parte de clientes y agrega actividad con LEFT JOIN", async () => {
  const migration = await readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8");
  assert.match(migration, /create or replace view public\.vista_clientes_crm_catalogo_master_v1 as/);
  assert.match(migration, /from public\.clientes c\s+left join movimientos m on m\.cliente_id = c\.cliente_id/s);
  assert.match(migration, /left join reservas r on r\.cliente_id = c\.cliente_id/s);
  assert.match(migration, /coalesce\(m\.total_visitas, 0\)::integer as total_visitas/);
  assert.match(migration, /coalesce\(m\.total_gastado, 0\)::numeric as total_gastado/);
});

test("el módulo Clientes consulta la vista maestra, no la vista operativa heredada", async () => {
  for (const path of ["../app/clientes/page.tsx", "../app/clientes/[cliente_id]/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /vista_clientes_crm_catalogo_master_v1/);
  }
});

test("los enlaces de WhatsApp usan E.164 y no fuerzan Perú", async () => {
  for (const path of ["../app/clientes/page.tsx", "../app/clientes/[cliente_id]/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /whatsapp_e164/);
    assert.match(source, /https:\/\/wa\.me\/\$\{canonical\}/);
    assert.doesNotMatch(source, /wa\.me\/51\$\{digits\}/);
  }
});
