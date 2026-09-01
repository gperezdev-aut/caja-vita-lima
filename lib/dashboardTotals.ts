import "server-only";

export type Row = Record<string, any>;

export type DashboardTotals = {
  ingresos: number;
  salidas: number;
  neto: number;
  pendientes: number;
  servicios: number;
  giftCards: number;
  prestamos: number;
  cuponidad: number;
};

export type DashboardKpiFormat = "money" | "number";

export const TODAS_LAS_SEDES = "TODAS";

export const DASHBOARD_KPIS: {
  key: keyof DashboardTotals;
  label: string;
  format: DashboardKpiFormat;
}[] = [
  { key: "ingresos", label: "Ingresos confirmados", format: "money" },
  { key: "salidas", label: "Total salidas", format: "money" },
  { key: "neto", label: "Resultado neto", format: "money" },
  { key: "pendientes", label: "Pendientes migración", format: "number" },
  { key: "servicios", label: "Servicios", format: "money" },
  { key: "giftCards", label: "Gift Cards", format: "money" },
  { key: "prestamos", label: "Préstamos de caja", format: "money" },
  { key: "cuponidad", label: "Cuponidad en caja", format: "money" },
];

export function normalizeMonth(value: any) {
  const text = String(value ?? "").trim();

  if (/^\d{4}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7);

  return "";
}

export function monthLabel(value: any) {
  if (!value) return "-";

  const safeValue = String(value).length === 7 ? `${value}-01` : String(value);
  const date = new Date(`${safeValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("es-PE", {
    month: "long",
    year: "numeric",
  });
}

export function getNumber(row: Row, key: string) {
  return Number(row?.[key] ?? 0);
}

export function getCuponidadFromMonthlyRow(row: Row) {
  const totalIngresos = getNumber(row, "Total ingresos confirmados");
  const servicios = getNumber(row, "Ingresos por servicios");
  const giftCards = getNumber(row, "Ingresos por Gift Cards");
  const prestamos = getNumber(row, "Préstamos de caja");

  return totalIngresos - servicios - giftCards - prestamos;
}

export function sumMonthlyRows(rows: Row[]): DashboardTotals {
  return rows.reduce<DashboardTotals>(
    (acc, row) => {
      acc.ingresos += getNumber(row, "Total ingresos confirmados");
      acc.salidas += getNumber(row, "Total salidas");
      acc.neto += getNumber(row, "Resultado neto confirmado");
      acc.pendientes += getNumber(row, "Filas pendientes de revisión");
      acc.servicios += getNumber(row, "Ingresos por servicios");
      acc.giftCards += getNumber(row, "Ingresos por Gift Cards");
      acc.prestamos += getNumber(row, "Préstamos de caja");
      acc.cuponidad += getCuponidadFromMonthlyRow(row);
      return acc;
    },
    {
      ingresos: 0,
      salidas: 0,
      neto: 0,
      pendientes: 0,
      servicios: 0,
      giftCards: 0,
      prestamos: 0,
      cuponidad: 0,
    }
  );
}

export function getDashboardTotals({
  filterActive,
  resumenRow,
  filteredMonthlyRows,
}: {
  filterActive: boolean;
  resumenRow: Row;
  filteredMonthlyRows: Row[];
}): DashboardTotals {
  if (filterActive) {
    return sumMonthlyRows(filteredMonthlyRows);
  }

  return {
    ingresos: getNumber(resumenRow, "Total ingresos confirmados"),
    salidas: getNumber(resumenRow, "Total salidas"),
    neto: getNumber(resumenRow, "Resultado neto confirmado"),
    pendientes: getNumber(resumenRow, "Total filas pendientes"),
    servicios: getNumber(resumenRow, "Total servicios"),
    giftCards: getNumber(resumenRow, "Total Gift Cards"),
    prestamos: getNumber(resumenRow, "Total préstamos de caja"),
    cuponidad: getNumber(resumenRow, "Total Cuponidad en caja"),
  };
}

/**
 * Convierte un rango de meses "YYYY-MM" (como los que ya usa el dashboard)
 * al primer y último día calendario de ese rango, en formato "YYYY-MM-DD",
 * para poder filtrar tablas con columna fecha (DATE) como caja_movimientos
 * o caja_salidas.
 */
export function monthRangeToDates(desde: string, hasta: string) {
  const fechaDesde = `${desde}-01`;

  const [hastaYear, hastaMonth] = hasta.split("-").map(Number);
  const lastDay = new Date(hastaYear, hastaMonth, 0).getDate();
  const fechaHasta = `${hasta}-${String(lastDay).padStart(2, "0")}`;

  return { fechaDesde, fechaHasta };
}

export type DashboardFilterParams = {
  desde?: string;
  hasta?: string;
  sede?: string;
};

export function resolveDashboardFilters({
  params,
  mensualRows,
}: {
  params: DashboardFilterParams;
  mensualRows: Row[];
}) {
  const months = mensualRows
    .map((row) => normalizeMonth(row.mes))
    .filter(Boolean)
    .sort();

  const minMonth = months[0] ?? "2026-01";
  const maxMonth = months[months.length - 1] ?? "2026-12";

  const rawDesde = normalizeMonth(params?.desde) || minMonth;
  const rawHasta = normalizeMonth(params?.hasta) || maxMonth;
  const selectedSede = String(params?.sede || TODAS_LAS_SEDES);

  const desde = rawDesde <= rawHasta ? rawDesde : rawHasta;
  const hasta = rawDesde <= rawHasta ? rawHasta : rawDesde;

  const filterActive = Boolean(
    params?.desde || params?.hasta || selectedSede !== TODAS_LAS_SEDES
  );

  const filteredMonthlyRows = mensualRows.filter((row) => {
    const rowMonth = normalizeMonth(row.mes);
    const rowSede = String(row.sede ?? "").trim();

    if (!rowMonth) return false;
    if (rowMonth < desde || rowMonth > hasta) return false;
    if (selectedSede !== TODAS_LAS_SEDES && rowSede !== selectedSede) {
      return false;
    }

    return true;
  });

  return { desde, hasta, selectedSede, filterActive, filteredMonthlyRows };
}
