import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clienteMaestroSinActividad,
  combinarClientesCrm,
  estadoActividadDesdeFechas,
  fechaActividadMasReciente,
} from "../lib/clientesCrmCompat.ts";

test("la lista CRM parte de clientes y agrega actividad con LEFT JOIN", async () => {
  const migration = await readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8");
  assert.match(migration, /create or replace view public\.vista_clientes_crm_catalogo_master_v1 as/);
  assert.match(migration, /from public\.clientes c[\s\S]*left join movimientos m on m\.cliente_id = c\.cliente_id/);
  assert.match(migration, /left join reservas r on r\.cliente_id = c\.cliente_id/);
  assert.match(migration, /coalesce\(m\.total_visitas, 0\)::integer as total_visitas/);
  assert.match(migration, /coalesce\(m\.total_gastado, 0\)::numeric as total_gastado/);
});

test("el módulo Clientes conserva el contrato CRM heredado y añade maestros por separado", async () => {
  for (const path of ["../app/clientes/page.tsx", "../app/clientes/[cliente_id]/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /vista_clientes_crm_catalogo/);
    assert.match(source, /"clientes"/);
  }
});

test("el contrato usado por Clientes conserva los campos CRM y catálogo sensibles", async () => {
  const source = await readFile(new URL("../app/clientes/page.tsx", import.meta.url), "utf8");
  for (const campo of [
    "servicio_mas_comprado_catalogo_nombre",
    "servicio_mas_comprado_catalogo_tipo",
    "servicio_mas_comprado_menu_group",
    "dias_sin_visita",
    "estado_cliente_crm",
    "nivel_cliente_crm",
    "alerta_atencion",
    "sede_frecuente",
    "total_visitas",
    "total_reservas",
    "total_gastado",
  ]) assert.match(source, new RegExp(campo));
});

test("un maestro ausente del CRM se añade sin inventar catálogo y no reemplaza CRM existente", () => {
  const maestro = { cliente_id: "CLI-1", cliente: "Nuevo", email: "nuevo@example.com" };
  assert.deepEqual(clienteMaestroSinActividad(maestro), {
    ...maestro, total_visitas: 0, total_gastado: 0, total_reservas: 0,
    estado_actividad_crm: "SIN_ACTIVIDAD", calidad_contacto_crm: "CON_DATO_PARCIAL",
  });
  const combinado = combinarClientesCrm([
    { cliente_id: "CLI-1", servicio_mas_comprado_catalogo_nombre: "Relax", total_gastado: 80 },
  ], [maestro]);
  assert.equal(combinado.length, 1);
  assert.equal(combinado[0].servicio_mas_comprado_catalogo_nombre, "Relax");
  assert.equal(combinado[0].total_gastado, 80);
  const actividadCorregida = combinarClientesCrm([
    { cliente_id: "CLI-2", ultima_visita: "2026-01-10", ultima_reserva: "2026-09-20" },
  ], [{ cliente_id: "CLI-2" }], "2026-09-21");
  assert.equal(actividadCorregida[0].estado_actividad_crm, "ACTIVO");
});

test("actividad CRM usa la fecha más reciente entre visita y reserva", () => {
  assert.equal(fechaActividadMasReciente("2026-09-10", null), "2026-09-10");
  assert.equal(fechaActividadMasReciente(null, "2026-09-20"), "2026-09-20");
  assert.equal(fechaActividadMasReciente("2026-09-20", "2026-09-10"), "2026-09-20");
  assert.equal(fechaActividadMasReciente("2026-01-10", "2026-09-20"), "2026-09-20");
  assert.equal(fechaActividadMasReciente(null, null), null);
  assert.equal(estadoActividadDesdeFechas("2026-01-10", "2026-09-20", "2026-09-21"), "ACTIVO");
  assert.equal(estadoActividadDesdeFechas(null, null, "2026-09-21"), "SIN_ACTIVIDAD");
});

test("la vista SQL usa greatest NULL-safe, no coalesce, para la actividad", async () => {
  const migration = await readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8");
  assert.match(migration, /when m\.ultima_visita_operativa is null then r\.ultima_reserva_operativa/);
  assert.match(migration, /when r\.ultima_reserva_operativa is null then m\.ultima_visita_operativa/);
  assert.match(migration, /else greatest\(m\.ultima_visita_operativa, r\.ultima_reserva_operativa\)/);
  assert.doesNotMatch(migration, /coalesce\(m\.ultima_visita_operativa, r\.ultima_reserva_operativa\) < current_date - 60/);
});

test("los enlaces de WhatsApp usan E.164 y no fuerzan Perú", async () => {
  for (const path of ["../app/clientes/page.tsx", "../app/clientes/[cliente_id]/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /whatsapp_e164/);
    assert.match(source, /https:\/\/wa\.me\/\$\{canonical\}/);
    assert.doesNotMatch(source, /wa\.me\/51\$\{digits\}/);
  }
});
