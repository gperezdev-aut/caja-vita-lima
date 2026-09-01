import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseSelect, supabaseSelectAllWhere } from "@/lib/supabaseServer";
import {
  DASHBOARD_KPIS,
  TODAS_LAS_SEDES,
  getDashboardTotals,
  monthLabel,
  monthRangeToDates,
  resolveDashboardFilters,
  type Row,
} from "@/lib/dashboardTotals";

const MONEY_FORMAT = '"S/" #,##0.00';

function money(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function numberFmt(value: number) {
  return value.toLocaleString("es-PE");
}

function hourLabel(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function setColumnWidths(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function addMoneyCell(row: ExcelJS.Row, columnIndex: number, value: unknown) {
  const cell = row.getCell(columnIndex);
  cell.value = Number(value ?? 0);
  cell.numFmt = MONEY_FORMAT;
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

  const { fechaDesde, fechaHasta } = monthRangeToDates(desde, hasta);
  const sedeFilter = selectedSede !== TODAS_LAS_SEDES
    ? [`sede=eq.${encodeURIComponent(selectedSede)}`]
    : [];

  const ingresosQuery = [
    "select=fecha,hora,sede,cliente,whatsapp,servicio,total_cobrar,total_pagado,pendiente,estado_boleta",
    `fecha=gte.${fechaDesde}`,
    `fecha=lte.${fechaHasta}`,
    ...sedeFilter,
    "order=fecha.asc,hora.asc",
  ].join("&");

  const salidasQuery = [
    "select=fecha,hora,sede,tipo_gasto,concepto,monto,responsable,observacion",
    `fecha=gte.${fechaDesde}`,
    `fecha=lte.${fechaHasta}`,
    ...sedeFilter,
    "order=fecha.asc,hora.asc",
  ].join("&");

  const [ingresosResult, salidasResult] = await Promise.all([
    supabaseSelectAllWhere<Row>("caja_movimientos", ingresosQuery),
    supabaseSelectAllWhere<Row>("caja_salidas", salidasQuery),
  ]);

  const ingresosSheet = workbook.addWorksheet("Ingresos");
  const ingresosHeaderRow = ingresosSheet.addRow([
    "Fecha",
    "Hora",
    "Sede",
    "Cliente",
    "WhatsApp",
    "Servicio",
    "Total cobrar",
    "Total pagado",
    "Pendiente",
    "Estado boleta",
  ]);
  ingresosHeaderRow.font = { bold: true };

  if (ingresosResult.error) {
    ingresosSheet.addRow([`No se pudo cargar Ingresos: ${ingresosResult.error}`]);
  }

  for (const row of ingresosResult.data) {
    const excelRow = ingresosSheet.addRow([
      row.fecha ?? "",
      hourLabel(row.hora),
      row.sede ?? "",
      row.cliente ?? "",
      row.whatsapp ?? "",
      row.servicio ?? "",
    ]);
    addMoneyCell(excelRow, 7, row.total_cobrar);
    addMoneyCell(excelRow, 8, row.total_pagado);
    addMoneyCell(excelRow, 9, row.pendiente);
    excelRow.getCell(10).value = row.estado_boleta ?? "";
  }

  setColumnWidths(ingresosSheet, [12, 8, 14, 26, 14, 32, 14, 14, 14, 16]);

  const salidasSheet = workbook.addWorksheet("Salidas");
  const salidasHeaderRow = salidasSheet.addRow([
    "Fecha",
    "Hora",
    "Sede",
    "Tipo de gasto",
    "Concepto",
    "Monto",
    "Responsable",
    "Observación",
  ]);
  salidasHeaderRow.font = { bold: true };

  if (salidasResult.error) {
    salidasSheet.addRow([`No se pudo cargar Salidas: ${salidasResult.error}`]);
  }

  for (const row of salidasResult.data) {
    const excelRow = salidasSheet.addRow([
      row.fecha ?? "",
      hourLabel(row.hora),
      row.sede ?? "",
      row.tipo_gasto ?? "",
      row.concepto ?? "",
    ]);
    addMoneyCell(excelRow, 6, row.monto);
    excelRow.getCell(7).value = row.responsable ?? "";
    excelRow.getCell(8).value = row.observacion ?? "";
  }

  setColumnWidths(salidasSheet, [12, 8, 14, 16, 32, 14, 16, 34]);

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
