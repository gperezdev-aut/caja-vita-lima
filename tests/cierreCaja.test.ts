import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cajaFisicaNoCalculable,
  esBoletaPendiente,
  normalizarMetodoCierre,
  resumirMovimientosOperativos,
  resumirPagosCierre,
  sumarSalidas,
} from "../lib/cierreCaja.ts";

test("cierre no atribuye pagos digitales a una diferencia de caja física", () => {
  const resumen = resumirPagosCierre([
    { metodo: "EFECTIVO", monto: 100 },
    { metodo: "YAPE", monto: 200 },
  ]);
  const resultadoFisico = cajaFisicaNoCalculable();

  assert.equal(resumen.total, 300);
  assert.equal(resumen.efectivo, 100);
  assert.equal(resumen.digital, 200);
  assert.deepEqual(resultadoFisico, {
    cajaEsperada: null,
    diferencia: null,
  });
  assert.notEqual(resultadoFisico.diferencia, -200);
});

test("cierre agrupa los métodos del ledger sin confundir efectivo y digital", () => {
  const resumen = resumirPagosCierre([
    { metodo: "Efectivo", monto: 15 },
    { metodo: "Yape", monto: 20 },
    { metodo: "Plin", monto: 25 },
    { metodo: "Izipay", monto: 30 },
    { metodo: "Transferencia BCP", monto: 35 },
    { metodo: "Transferencia Interbank", monto: 40 },
  ]);

  assert.equal(resumen.total, 165);
  assert.equal(resumen.efectivo, 15);
  assert.equal(resumen.digital, 150);
  assert.deepEqual(resumen.porMetodo, {
    EFECTIVO: 15,
    YAPE: 20,
    PLIN: 25,
    "IZIPAY POS": 30,
    BCP: 35,
    OTRO: 40,
  });
  assert.equal(normalizarMetodoCierre("transferencia"), "OTRO");
});

test("cierre mantiene salidas y métricas operativas separadas de pagos", () => {
  assert.equal(sumarSalidas([{ monto: 12.5 }, { monto: "7.50" }]), 20);
  assert.equal(esBoletaPendiente({ estado_boleta: "Pendiente" }), true);
  assert.deepEqual(
    resumirMovimientosOperativos([
      { n_pax: 2, estado_boleta: "Pendiente" },
      { n_pax: 1, estado_boleta: "No aplica" },
    ]),
    { paxTotal: 3, boletasPendientes: 1 }
  );
});

test("casos E/F: el adelanto entra solo en el cierre de su fecha real", () => {
  const ledger = [
    { fecha: "2026-09-12", metodo: "YAPE", monto: 115, cita: "2026-09-20" },
  ];
  const cierre12 = resumirPagosCierre(
    ledger.filter((row) => row.fecha === "2026-09-12")
  );
  const cierre20 = resumirPagosCierre(
    ledger.filter((row) => row.fecha === "2026-09-20")
  );

  assert.equal(cierre12.total, 115);
  assert.equal(cierre20.total, 0);
});

test("la app recalcula el cierre server-side y exporta caja_pagos", async () => {
  const [action, page, exportRoute] = await Promise.all([
    readFile(new URL("../app/cierre-caja/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/cierre-caja/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/export/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(action, /supabaseSelectAllWhere[\s\S]*"caja_pagos"/);
  assert.doesNotMatch(action, /money\(formData\.get\("total_ingresos"\)\)/);
  assert.match(action, /cajaFisicaNoCalculable\(\)/);
  assert.doesNotMatch(action, /efectivoContado\s*-\s*cajaEsperada/);
  assert.match(page, /resumirPagosCierre\(pagos\.data\)/);
  assert.match(page, /value == null \? "No calculable"/);
  assert.match(exportRoute, /supabaseSelectAllWhere<Row>\("caja_pagos", ingresosQuery\)/);
});

test("021 fija hora de cobro en PostgreSQL y conserva contrato idempotente", async () => {
  const sql = await readFile(
    new URL("../sql/021_pagos_fecha_real_ledger.sql", import.meta.url),
    "utf8"
  );

  assert.equal((sql.match(/v_instante_cobro::date/gi) ?? []).length, 2);
  assert.equal((sql.match(/v_instante_cobro::time/gi) ?? []).length, 2);
  assert.equal((sql.match(/now\(\) at time zone 'America\/Lima'/gi) ?? []).length >= 2, true);
  assert.match(sql, /where request_id = v_request_id for update/i);
  assert.match(sql, /where request_id=v_request for update/i);
  assert.match(sql, /from public\.caja_pagos p[\s\S]*group by date_trunc\('month', p\.fecha\)/i);
  assert.doesNotMatch(
    sql,
    /insert into public\.caja_pagos[^;]+values\s*\([^;]*v_fecha\s*,\s*v_hora/i
  );
});

test("reporte mensual clasifica pagos de app como servicios sin alterar el total", async () => {
  const [sql, rollback] = await Promise.all([
    readFile(new URL("../sql/021_pagos_fecha_real_ledger.sql", import.meta.url), "utf8"),
    readFile(
      new URL("../sql/tests/021_pagos_fecha_real_ledger_rollback.sql", import.meta.url),
      "utf8"
    ),
  ]);

  assert.match(
    sql,
    /m\.tipo_movimiento in \(\s*'ATENCION_HISTORICA',\s*'RESERVA_APP',\s*'ATENCION_APP'\s*\)/i
  );
  assert.match(
    sql,
    /sum\(coalesce\(p\.monto, 0\)\) as total_ingresos_confirmados/i
  );
  assert.match(rollback, /'ATENCION_APP', 25/);
  assert.match(rollback, /QA_021_FINANCIAL_CLASSIFICATION/);
});
