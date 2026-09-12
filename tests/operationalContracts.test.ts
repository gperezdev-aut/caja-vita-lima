import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Preparar cita y Citas de hoy comparten caja_movimientos por fecha de cita", async () => {
  const [action, citas, sql] = await Promise.all([
    read("../app/preparar-cita/actions.ts"),
    read("../app/citas-hoy/page.tsx"),
    read("../sql/020_preparar_cita_catalogo_canonico.sql"),
  ]);

  assert.match(action, /"preparar_atencion_personalizada"\s*:\s*"preparar_ficha_cita"/);
  assert.match(sql, /insert into public\.caja_movimientos/i);
  assert.match(sql, /v_movimiento_id, v_fecha, v_hora, v_sede, 'RESERVA_APP'/i);
  assert.match(sql, /'APP_CAJA_FICHA', v_reserva_id/i);
  assert.match(citas, /"caja_movimientos"/);
  assert.match(citas, /`fecha=eq\.\$\{selectedFecha\}`/);
  for (const field of ["cliente_id", "servicio", "total_cobrar", "total_pagado", "pendiente", "estado", "estado_boleta", "source_id"]) {
    assert.match(citas, new RegExp(field));
  }
});

test("Preparar cita persiste el monto recibido real y calcula el saldo desde ese monto", async () => {
  const sql = await read("../sql/020_preparar_cita_catalogo_canonico.sql");
  assert.match(sql, /v_subtotal, v_pagado, nullif\(v_metodo_pago, ''\), v_total, v_pagado/i);
  assert.match(sql, /greatest\(v_total - v_pagado, 0\)/i);
  assert.match(sql, /v_total, v_pagado,\s*nullif\(v_metodo_pago, ''\), greatest\(v_total - v_pagado, 0\)/i);
  assert.match(sql, /values \(v_pago_id, v_movimiento_id, v_fecha, v_hora, v_sede, 'ADELANTO_APP'/i);
});

test("caracterización del bloqueante: pago hoy y cita futura usan hoy la fecha de cita", async () => {
  const [sql, cierre, dashboard] = await Promise.all([
    read("../sql/020_preparar_cita_catalogo_canonico.sql"),
    read("../app/cierre-caja/page.tsx"),
    read("../sql/011_fix_reporte_financiero.sql"),
  ]);

  assert.doesNotMatch(sql, /v_fecha_pago|fecha_pago/);
  assert.match(sql, /values \(v_pago_id, v_movimiento_id, v_fecha, v_hora/i);
  assert.match(cierre, /sum, row\) => sum \+ Number\(row\.total_pagado/);
  assert.match(dashboard, /date_trunc\('month', fecha\)[\s\S]*caja_movimientos/i);
});

test("Nueva atención sigue siendo alta independiente y no se enlaza desde una reserva", async () => {
  const [page, action, citas] = await Promise.all([
    read("../app/nueva-atencion/page.tsx"),
    read("../app/nueva-atencion/actions.ts"),
    read("../app/citas-hoy/page.tsx"),
  ]);

  assert.match(page, /stg_services_catalog_v5/);
  assert.match(page, /stg_promotions_v1/);
  assert.match(action, /const movimientoId = id\("MOV"\)/);
  assert.match(action, /const reservaId = id\("RES"\)/);
  assert.doesNotMatch(citas, /Iniciar atención/);
});

test("Comprobantes exige consistencia y atribuye la revisión a la sesión", async () => {
  const action = await read("../app/comprobantes/actions.ts");
  assert.match(action, /const session = await requireModuleAccess\("comprobantes"\)/);
  assert.match(action, /const revisadoPor = session\.nombre/);
  assert.match(action, /estadoComprobante === "OK" && \(!numeroComprobante \|\| !fechaEmision\)/);
  assert.match(action, /tipoComprobante === "NO_APLICA" && estadoComprobante !== "NO_APLICA"/);
});

test("la capa visual cubre móvil 360/390 y mantiene tablas en scroll controlado", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /@media\(max-width:599px\)/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /\.tableWrap\{max-width:100%;overscroll-behavior-inline:contain/);
  assert.match(css, /\.crmMobileList\{display:grid;gap:12px\}/);
  assert.match(css, /min-height:48px;font-size:16px/);
});
