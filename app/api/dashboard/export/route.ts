import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelect } from "@/lib/supabaseServer";
import {
  DASHBOARD_KPIS,
  TODAS_LAS_SEDES,
  getDashboardTotals,
  monthLabel,
  resolveDashboardFilters,
  type Row,
} from "@/lib/dashboardTotals";

function money(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function numberFmt(value: number) {
  return value.toLocaleString("es-PE");
}

export async function GET(request: NextRequest) {
  await requireModuleAccess("dashboard");

  const { searchParams } = new URL(request.url);
  const params = {
    desde: searchParams.get("desde") ?? undefined,
    hasta: searchParams.get("hasta") ?? undefined,
    sede: searchParams.get("sede") ?? undefined,
  };

  const resumen = await supabaseSelect<Row>(
    "vista_reporte_socio_resumen_con_alertas_v3"
  );
  const mensual = await supabaseSelect<Row>("vista_reporte_socio_mensual");

  const r = resumen.data?.[0] ?? {};

  const { desde, hasta, selectedSede, filterActive, filteredMonthlyRows } =
    resolveDashboardFilters({ params, mensualRows: mensual.data });

  const totals = getDashboardTotals({
    filterActive,
    resumenRow: r,
    filteredMonthlyRows,
  });

  const sedeLabel = selectedSede === TODAS_LAS_SEDES ? "Todas las sedes" : selectedSede;
  const rangeLabel = filterActive
    ? `${monthLabel(desde)} a ${monthLabel(hasta)}`
    : "Todo lo cargado";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Caja Vita Lima";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Dashboard KPIs");

  sheet.addRow(["Dashboard Caja Vita Lima"]).font = { bold: true, size: 14 };
  sheet.addRow(["Rango", rangeLabel]);
  sheet.addRow(["Sede", sedeLabel]);
  sheet.addRow(["Generado", new Date().toLocaleString("es-PE")]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(["Indicador", "Valor"]);
  headerRow.font = { bold: true };

  for (const kpi of DASHBOARD_KPIS) {
    const raw = totals[kpi.key];
    const value = kpi.format === "money" ? money(raw) : numberFmt(raw);
    sheet.addRow([kpi.label, value]);
  }

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 22;

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `dashboard_${desde}_${hasta}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
