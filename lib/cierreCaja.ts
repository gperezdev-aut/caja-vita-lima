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

export type PropinaCierre = PagoCierre & {
  estado?: unknown;
};

export type MovimientoCierre = {
  n_pax?: unknown;
  estado_comprobante_manual?: unknown;
  tipo_comprobante?: unknown;
  estado_boleta?: unknown;
};

export type SalidaGastoCierre = {
  monto?: unknown;
  metodo_salida?: unknown;
  categoria_financiera?: unknown;
  tipo_gasto?: unknown;
  concepto?: unknown;
};

export type MovimientoFondoCierre = {
  monto?: unknown;
  metodo?: unknown;
  tipo_movimiento?: unknown;
};

export type CategoriaFinancieraSalida =
  | "GASTO_OPERATIVO"
  | "ENTREGA_PROPINA"
  | "MOVIMIENTO_FONDOS"
  | "DEVOLUCION_PRESTAMO"
  | "SIN_CLASIFICAR";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safeMoney(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizarTexto(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizarMetodoCierre(value: unknown): MetodoCierre {
  const metodo = normalizarTexto(value);

  if (metodo === "EFECTIVO") return "EFECTIVO";
  if (metodo.includes("YAPE")) return "YAPE";
  if (metodo.includes("PLIN")) return "PLIN";
  if (metodo.includes("IZIPAY") || metodo === "POS") return "IZIPAY POS";
  if (metodo.includes("BCP")) return "BCP";
  return "OTRO";
}

export function clasificarSalidaFinanciera(
  row: SalidaGastoCierre
): CategoriaFinancieraSalida {
  const categoria = normalizarTexto(row.categoria_financiera);

  if (
    categoria === "GASTO_OPERATIVO" ||
    categoria === "ENTREGA_PROPINA" ||
    categoria === "MOVIMIENTO_FONDOS" ||
    categoria === "DEVOLUCION_PRESTAMO" ||
    categoria === "SIN_CLASIFICAR"
  ) {
    return categoria;
  }

  const tipo = normalizarTexto(row.tipo_gasto);
  const concepto = normalizarTexto(row.concepto);

  if (tipo === "PROPINA") return "ENTREGA_PROPINA";
  if (tipo === "DEPOSITOS" || tipo === "DEPOSITO") return "MOVIMIENTO_FONDOS";
  if (
    tipo === "PAGO PERSONAL" ||
    tipo === "OTROS" ||
    tipo === "OTRO"
  ) {
    return "SIN_CLASIFICAR";
  }

  if (
    tipo === "AGUA" ||
    tipo === "INSUMOS" ||
    tipo === "LAVANDERIA" ||
    tipo === "PASAJE" ||
    tipo === "MOVILIDAD" ||
    tipo === "LIMPIEZA" ||
    tipo === "ALQUILER" ||
    tipo === "SERVICIOS" ||
    tipo === "REPARACION" ||
    tipo === "APOYO THERAPY"
  ) {
    return "GASTO_OPERATIVO";
  }

  if (
    concepto.includes("DEVOLUCION DE PRESTAMO") ||
    concepto.includes("PAGO DE PRESTAMO") ||
    concepto.includes("REEMBOLSO DE PRESTAMO")
  ) {
    return "DEVOLUCION_PRESTAMO";
  }

  return "SIN_CLASIFICAR";
}

export function resumirPagosCierre(rows: PagoCierre[]) {
  const porMetodo = Object.fromEntries(
    METODOS_CIERRE.map((metodo) => [metodo, 0])
  ) as Record<MetodoCierre, number>;

  for (const row of rows) {
    const monto = safeMoney(row.monto);
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

export function resumirPropinasCierre(rows: PropinaCierre[]) {
  return resumirPagosCierre(
    rows.filter(
      (row) =>
        String(row.estado ?? "PENDIENTE").trim().toUpperCase() !== "ANULADA"
    )
  );
}

export function resumirDineroProcesadoCierre(
  pagos: PagoCierre[],
  propinas: PropinaCierre[]
) {
  const ingresos = resumirPagosCierre(pagos);
  const tips = resumirPropinasCierre(propinas);
  const porMetodo = Object.fromEntries(
    METODOS_CIERRE.map((metodo) => [
      metodo,
      ingresos.porMetodo[metodo] + tips.porMetodo[metodo],
    ])
  ) as Record<MetodoCierre, number>;

  return {
    ingresos,
    propinas: tips,
    totalProcesado: ingresos.total + tips.total,
    efectivoProcesado: porMetodo.EFECTIVO,
    digitalProcesado: METODOS_CIERRE.filter((metodo) => metodo !== "EFECTIVO").reduce(
      (sum, metodo) => sum + porMetodo[metodo],
      0
    ),
    porMetodo,
  };
}

export function resumirSalidasCierre(
  salidasLegacyYGastos: SalidaGastoCierre[],
  movimientosFondos: MovimientoFondoCierre[]
) {
  let totalGastos = 0;
  let totalGastosEfectivo = 0;
  let totalSalidasLegacyEfectivo = 0;
  let totalMovimientosFondos = 0;
  let totalMovimientosFondosEfectivo = 0;
  let salidasSinMetodo = 0;
  let salidasSinClasificar = 0;

  for (const row of salidasLegacyYGastos) {
    const monto = safeMoney(row.monto);
    const categoria = clasificarSalidaFinanciera(row);

    if (categoria === "GASTO_OPERATIVO") {
      totalGastos += monto;
    } else if (categoria === "SIN_CLASIFICAR" && monto > 0.009) {
      salidasSinClasificar += 1;
    }

    const rawMetodo = String(row.metodo_salida ?? "").trim();
    if (!rawMetodo) {
      if (monto > 0.009) salidasSinMetodo += 1;
      continue;
    }

    if (normalizarMetodoCierre(rawMetodo) === "EFECTIVO") {
      totalSalidasLegacyEfectivo += monto;
      if (categoria === "GASTO_OPERATIVO") {
        totalGastosEfectivo += monto;
      }
    }
  }

  for (const row of movimientosFondos) {
    const monto = safeMoney(row.monto);
    totalMovimientosFondos += monto;

    const rawMetodo = String(row.metodo ?? "").trim();
    if (!rawMetodo) {
      if (monto > 0.009) salidasSinMetodo += 1;
      continue;
    }

    const tipo = normalizarTexto(row.tipo_movimiento);
    const metodo = normalizarMetodoCierre(rawMetodo);

    if (metodo === "EFECTIVO" && tipo !== "TRANSFERENCIA") {
      totalMovimientosFondosEfectivo += monto;
    }
  }

  const totalSalidasEfectivo =
    totalSalidasLegacyEfectivo + totalMovimientosFondosEfectivo;

  return {
    totalGastos: roundMoney(totalGastos),
    totalGastosEfectivo: roundMoney(totalGastosEfectivo),
    totalMovimientosFondos: roundMoney(totalMovimientosFondos),
    totalMovimientosFondosEfectivo: roundMoney(totalMovimientosFondosEfectivo),
    totalSalidasEfectivo: roundMoney(totalSalidasEfectivo),
    salidasSinMetodo,
    salidasSinClasificar,
    fisicoCalculable: salidasSinMetodo === 0,
  };
}

export function calcularCajaFisica({
  cajaInicial,
  efectivoVitaLima,
  efectivoPropinas,
  totalSalidasEfectivo,
  efectivoContado,
  fondoSiguiente,
  calculable,
}: {
  cajaInicial: number;
  efectivoVitaLima: number;
  efectivoPropinas: number;
  totalSalidasEfectivo: number;
  efectivoContado: number;
  fondoSiguiente: number;
  calculable: boolean;
}) {
  if (!calculable) {
    return {
      cajaEsperada: null,
      diferencia: null,
      efectivoARetirar: null,
    } as const;
  }

  const cajaEsperada = roundMoney(
    cajaInicial + efectivoVitaLima + efectivoPropinas - totalSalidasEfectivo
  );
  const diferencia = roundMoney(efectivoContado - cajaEsperada);
  const efectivoARetirar = roundMoney(
    Math.max(efectivoContado - fondoSiguiente, 0)
  );

  return {
    cajaEsperada,
    diferencia,
    efectivoARetirar,
  } as const;
}

export function sumarSalidas(rows: { monto?: unknown }[]) {
  return roundMoney(
    rows.reduce((sum, row) => sum + safeMoney(row.monto), 0)
  );
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
