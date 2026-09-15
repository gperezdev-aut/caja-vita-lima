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

test("el módulo Clientes conserva el contrato CRM heredado al enriquecer maestros", async () => {
  const [page, detail, migration] = await Promise.all([
    readFile(new URL("../app/clientes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/clientes/[cliente_id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /caja_clientes_crm_catalogo_paginado_v1/);
  assert.match(detail, /vista_clientes_crm_catalogo/);
  assert.match(detail, /"clientes"/);
  assert.match(migration, /to_jsonb\(c\)[\s\S]*coalesce\(to_jsonb\(v\), '\{\}'::jsonb\)/);
});

test("Clientes pagina desde el maestro sin depender de un límite de mil filas", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../app/clientes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /caja_clientes_crm_catalogo_paginado_v1/);
  assert.match(page, /CLIENTES_POR_PAGINA = 50/);
  assert.match(page, /p_offset: offset/);
  assert.match(page, /Página \{paginaMostrada\} de \{totalPaginas\}/);
  assert.doesNotMatch(page, /limit=1000/);
  assert.doesNotMatch(page, /combinarClientesCrm/);

  assert.match(migration, /create or replace function public\.caja_clientes_crm_catalogo_paginado_v1/);
  assert.match(migration, /from public\.clientes c[\s\S]*left join public\.vista_clientes_crm_catalogo v on v\.cliente_id = c\.cliente_id/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit, 50\), 1\), 100\)/);
  assert.match(migration, /limit \(select limite from paginacion\)[\s\S]*offset \(select desplazamiento_resuelto from paginacion\)/);
  assert.doesNotMatch(migration, /limit p\.limite offset p\.desplazamiento_resuelto/);
  assert.doesNotMatch(migration, /limit=1000/);
});

test("una página solicitada fuera de rango se resuelve a la última página válida", async () => {
  const [page, migration] = await Promise.all([
    readFile(new URL("../app/clientes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /paginacion as \([\s\S]*when r\.total_clientes = 0 then 0[\s\S]*least\([\s\S]*p\.desplazamiento,[\s\S]*\(\(r\.total_clientes - 1\) \/ p\.limite\) \* p\.limite/);
  assert.match(migration, /'offset', desplazamiento_resuelto/);
  assert.match(migration, /limit \(select limite from paginacion\)[\s\S]*offset \(select desplazamiento_resuelto from paginacion\)/);
  assert.match(page, /const offsetResuelto = Number\(catalogo\?\.paginacion\?\.offset \?\? offset\)/);
  assert.match(page, /const paginaMostrada = Math\.floor\(offsetResuelto \/ CLIENTES_POR_PAGINA\) \+ 1/);
});

test("la búsqueda por servicio incluye ultimo_servicio del maestro sin CRM", async () => {
  const migration = await readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8");
  assert.match(migration, /fila->>'servicio_mas_comprado' ilike/);
  assert.match(migration, /fila->>'servicio_mas_comprado_catalogo_nombre' ilike/);
  assert.match(migration, /fila->>'ultimo_servicio' ilike/);
});

test("la consulta paginada conserva métricas y rankings de todo el filtro", async () => {
  const migration = await readFile(new URL("../sql/026_clientes_master_internacional.sql", import.meta.url), "utf8");
  for (const token of [
    "'resumen'",
    "'top'",
    "'recuperar'",
    "count(*)::integer as total_clientes",
    "coalesce(sum(total_gastado), 0)::numeric as total_gastado",
    "select * from ordenados limit 8",
    "where actividad_crm = 'Inactivo' or estado_crm = 'Inactivo'",
  ]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
