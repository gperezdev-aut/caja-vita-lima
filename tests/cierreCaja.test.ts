import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  calcularCajaFisica,
  esBoletaPendiente,
  normalizarMetodoCierre,
  resumirDineroProcesadoCierre,
  resumirMovimientosOperativos,
  resumirPagosCierre,
  resumirPropinasCierre,
  resumirSalidasCierre,
  sumarSalidas,
} from "../lib/cierreCaja.ts";

test("cierre calcula caja física sin atribuir pagos digitales al efectivo", () => {
  const procesado = resumirDineroProcesadoCierre(
    [
      { metodo: "EFECTIVO", monto: 100 },
      { metodo: "YAPE", monto: 200 },
    ],
    [{ metodo: "EFECTIVO", monto: 10, estado: "PENDIENTE" }]
  );

  const salidas = resumirSalidasCierre(
    [
      { metodo_salida: "EFECTIVO", monto: 30 },
      { metodo_salida: "YAPE", monto: 40 },
    ],
    [
      { tipo_movimiento: "RETIRO_CAJA", metodo: "EFECTIVO", monto: 20 },
      { tipo_movimiento: "TRANSFERENCIA", metodo: "BCP", monto: 50 },
    ]
  );

  const fisico = calcularCajaFisica({
    cajaInicial: 50,
    efectivoVitaLima: procesado.ingresos.efectivo,
    efectivoPropinas: procesado.propinas.efectivo,
    totalSalidasEfectivo: salidas.totalSalidasEfectivo,
    efectivoContado: 108,
    fondoSiguiente: 50,
    calculable: salidas.fisicoCalculable,
  });

  assert.equal(procesado.ingresos.total, 300);
  assert.equal(procesado.ingresos.efectivo, 100);
  assert.equal(procesado.ingresos.digital, 200);
  assert.equal(salidas.totalGastos, 70);
  assert.equal(salidas.totalGastosEfectivo, 30);
  assert.equal(salidas.totalMovimientosFondos, 70);
  assert.equal(salidas.totalMovimientosFondosEfectivo, 20);
  assert.equal(salidas.totalSalidasEfectivo, 50);
  assert.deepEqual(fisico, {
    cajaEsperada: 110,
    diferencia: -2,
    efectivoARetirar: 58,
  });
});

test("cierre no inventa caja física si existe una salida histórica sin método", () => {
  const salidas = resumirSalidasCierre(
    [{ monto: 12.5, metodo_salida: null }],
    []
  );

  const fisico = calcularCajaFisica({
    cajaInicial: 100,
    efectivoVitaLima: 20,
    efectivoPropinas: 0,
    totalSalidasEfectivo: salidas.totalSalidasEfectivo,
    efectivoContado: 108,
    fondoSiguiente: 100,
    calculable: salidas.fisicoCalculable,
  });

  assert.equal(salidas.salidasSinMetodo, 1);
  assert.equal(salidas.fisicoCalculable, false);
  assert.deepEqual(fisico, {
    cajaEsperada: null,
    diferencia: null,
    efectivoARetirar: null,
  });
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

test("propinas se separan de ingresos pero sí forman parte del dinero procesado", () => {
  const pagos = [
    { metodo: "EFECTIVO", monto: 40 },
    { metodo: "IZIPAY POS", monto: 70 },
  ];
  const propinas = [
    { metodo: "IZIPAY POS", monto: 20, estado: "PENDIENTE" },
    { metodo: "EFECTIVO", monto: 5, estado: "ANULADA" },
  ];

  const soloPropinas = resumirPropinasCierre(propinas);
  const procesado = resumirDineroProcesadoCierre(pagos, propinas);

  assert.equal(soloPropinas.total, 20);
  assert.equal(procesado.ingresos.total, 110);
  assert.equal(procesado.propinas.total, 20);
  assert.equal(procesado.totalProcesado, 130);
  assert.equal(procesado.porMetodo.EFECTIVO, 40);
  assert.equal(procesado.porMetodo["IZIPAY POS"], 90);
});

test("cierre mantiene gastos y métricas operativas separadas de pagos", () => {
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

test("la app recalcula el cuadre server-side, separa fondos y bloquea cierres duplicados", async () => {
  const [action, page, exportRoute, migration036, migration042] =
    await Promise.all([
      readFile(new URL("../app/cierre-caja/actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/cierre-caja/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/dashboard/export/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../sql/036_cierre_caja_propinas_v2.sql", import.meta.url), "utf8"),
      readFile(new URL("../sql/042_cierre_caja_fisica_v3.sql", import.meta.url), "utf8"),
    ]);

  assert.match(action, /supabaseSelectAllWhere[\s\S]*"caja_pagos"/);
  assert.match(action, /supabaseSelectAllWhere[\s\S]*"caja_propinas"/);
  assert.match(action, /supabaseSelectAllWhere[\s\S]*"caja_salidas"/);
  assert.match(action, /supabaseSelectAllWhere[\s\S]*"caja_movimientos_fondos"/);
  assert.match(action, /resumirSalidasCierre\(/);
  assert.match(action, /calcularCajaFisica\(/);
  assert.match(action, /cierreExistente\.data\.length > 0/);
  assert.match(action, /total_salidas_efectivo:/);
  assert.match(action, /efectivo_a_retirar:/);
  assert.match(action, /cierre_fisico_calculable:\s*true/);
  assert.doesNotMatch(action, /money\(formData\.get\("total_ingresos"\)\)/);

  assert.match(page, /cajaInicialSugerida/);
  assert.match(page, /Salidas que reducen efectivo/);
  assert.match(page, /Efectivo a retirar\/depositar|A retirar\/depositar/);

  assert.match(exportRoute, /supabaseSelectAllWhere<Row>\("caja_pagos", ingresosQuery\)/);

  assert.match(migration036, /total_propinas/);
  assert.match(migration036, /total_procesado/);

  assert.match(migration042, /add column if not exists metodo_salida text/);
  assert.match(migration042, /create table if not exists public\.caja_movimientos_fondos/);
  assert.match(migration042, /efectivo_vita_lima/);
  assert.match(migration042, /total_salidas_efectivo/);
  assert.match(migration042, /efectivo_a_retirar/);
  assert.match(migration042, /cierre_fisico_calculable/);
  assert.doesNotMatch(migration042, /update\s+public\.caja_salidas/i);
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
