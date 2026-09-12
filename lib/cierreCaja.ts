export const METODOS_CIERRE = [
  "EFECTIVO",
  "YAPE",
  "PLIN",
  "IZIPAY POS",
  "BCP",
  "OTRO",
] as const;

export type MetodoCierre = (typeof METODOS_CIERRE)[number];

export type PagoCierre = {
  metodo?: unknown;
  monto?: unknown;
};

export type MovimientoCierre = {
  n_pax?: unknown;
  estado_comprobante_manual?: unknown;
  tipo_comprobante?: unknown;
  estado_boleta?: unknown;
};

export function normalizarMetodoCierre(value: unknown): MetodoCierre {
  const metodo = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (metodo === "EFECTIVO") return "EFECTIVO";
  if (metodo.includes("YAPE")) return "YAPE";
  if (metodo.includes("PLIN")) return "PLIN";
  if (metodo.includes("IZIPAY") || metodo === "POS") return "IZIPAY POS";
  if (metodo.includes("BCP")) return "BCP";
  return "OTRO";
}

export function resumirPagosCierre(rows: PagoCierre[]) {
  const porMetodo = Object.fromEntries(
    METODOS_CIERRE.map((metodo) => [metodo, 0])
  ) as Record<MetodoCierre, number>;

  for (const row of rows) {
    const monto = Number(row.monto ?? 0);
    if (!Number.isFinite(monto)) continue;
    porMetodo[normalizarMetodoCierre(row.metodo)] += monto;
  }

  return {
    total: METODOS_CIERRE.reduce((sum, metodo) => sum + porMetodo[metodo], 0),
    efectivo: porMetodo.EFECTIVO,
    digital: METODOS_CIERRE.filter((metodo) => metodo !== "EFECTIVO").reduce(
      (sum, metodo) => sum + porMetodo[metodo],
      0
    ),
    porMetodo,
  };
}

export function sumarSalidas(rows: { monto?: unknown }[]) {
  return rows.reduce((sum, row) => {
    const monto = Number(row.monto ?? 0);
    return sum + (Number.isFinite(monto) ? monto : 0);
  }, 0);
}

export function esBoletaPendiente(row: MovimientoCierre) {
  const estado = String(
    row.estado_comprobante_manual || row.estado_boleta || row.tipo_comprobante || ""
  ).toUpperCase();

  return (
    estado.includes("PEND") ||
    estado.includes("OBSERV") ||
    estado.includes("POR_DEFINIR")
  );
}

export function resumirMovimientosOperativos(rows: MovimientoCierre[]) {
  return {
    paxTotal: rows.reduce((sum, row) => sum + Number(row.n_pax ?? 0), 0),
    boletasPendientes: rows.filter(esBoletaPendiente).length,
  };
}
