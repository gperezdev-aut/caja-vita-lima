export type PagoV2 = {
  metodo: string;
  monto: number;
  numeroOperacion?: string | null;
};

export type AjusteV2 = {
  tipo: "DESCUENTO" | "CORTESIA" | "AJUSTE_PRECIO";
  monto: number;
  motivo: string;
};

export type CoberturaV2 = {
  tipo: "GIFT_CARD" | "CONVENIO_BEE" | "CONVENIO_CUPONIDAD" | "OTRA_COBERTURA";
  monto: number;
  referenciaId?: string | null;
};

export type ConciliacionAtencionInput = {
  montoServicio: number;
  totalExtras?: number;
  movilidad?: number;
  ajustes?: AjusteV2[];
  coberturas?: CoberturaV2[];
  pagosPrevios?: number;
  pagosNuevos?: PagoV2[];
  propina?: number;
};

export function redondearDineroV2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function montoValido(value: number) {
  return Number.isFinite(value) && value >= 0 && redondearDineroV2(value) === value;
}

export function sumarPagosV2(pagos: PagoV2[]) {
  return redondearDineroV2(pagos.reduce((sum, pago) => sum + Number(pago.monto || 0), 0));
}

export function validarPagosV2(pagos: PagoV2[]) {
  for (const pago of pagos) {
    const metodo = String(pago.metodo ?? "").trim().toUpperCase();
    if (!montoValido(pago.monto) || pago.monto <= 0) return "PAGO_INVALIDO";
    if (!metodo) return "METODO_PAGO_REQUERIDO";
    if (metodo !== "EFECTIVO" && !String(pago.numeroOperacion ?? "").trim()) {
      return "NUMERO_OPERACION_REQUERIDO";
    }
  }
  return null;
}

export function calcularConciliacionAtencionV2(input: ConciliacionAtencionInput) {
  const totalExtras = redondearDineroV2(input.totalExtras ?? 0);
  const movilidad = redondearDineroV2(input.movilidad ?? 0);
  const pagosPrevios = redondearDineroV2(input.pagosPrevios ?? 0);
  const propina = redondearDineroV2(input.propina ?? 0);
  const ajustes = input.ajustes ?? [];
  const coberturas = input.coberturas ?? [];
  const pagosNuevos = input.pagosNuevos ?? [];

  if (!montoValido(input.montoServicio) || !montoValido(totalExtras) || !montoValido(movilidad)) {
    return { ok: false as const, error: "IMPORTES_BASE_INVALIDOS" };
  }
  if (!montoValido(pagosPrevios) || !montoValido(propina)) {
    return { ok: false as const, error: "IMPORTES_PAGO_INVALIDOS" };
  }

  for (const ajuste of ajustes) {
    if (!montoValido(ajuste.monto) || ajuste.monto <= 0 || !ajuste.motivo.trim()) {
      return { ok: false as const, error: "AJUSTE_INVALIDO" };
    }
  }
  for (const cobertura of coberturas) {
    if (!montoValido(cobertura.monto) || cobertura.monto <= 0) {
      return { ok: false as const, error: "COBERTURA_INVALIDA" };
    }
  }

  const errorPagos = validarPagosV2(pagosNuevos);
  if (errorPagos) return { ok: false as const, error: errorPagos };

  const brutoConsumido = redondearDineroV2(input.montoServicio + totalExtras + movilidad);
  const totalAjustes = redondearDineroV2(ajustes.reduce((sum, item) => sum + item.monto, 0));
  if (totalAjustes > brutoConsumido) {
    return { ok: false as const, error: "AJUSTES_SUPERAN_BRUTO" };
  }

  const ventaNetaVita = redondearDineroV2(brutoConsumido - totalAjustes);
  const totalCoberturas = redondearDineroV2(coberturas.reduce((sum, item) => sum + item.monto, 0));
  if (totalCoberturas > ventaNetaVita) {
    return { ok: false as const, error: "COBERTURAS_SUPERAN_VENTA_NETA" };
  }
  if (pagosPrevios > ventaNetaVita - totalCoberturas) {
    return { ok: false as const, error: "PAGOS_PREVIOS_SUPERAN_SALDO" };
  }

  const saldoAntesCobro = redondearDineroV2(
    ventaNetaVita - totalCoberturas - pagosPrevios
  );
  const totalPagosNuevos = sumarPagosV2(pagosNuevos);
  if (totalPagosNuevos > saldoAntesCobro) {
    return { ok: false as const, error: "PAGOS_NUEVOS_SUPERAN_PENDIENTE" };
  }

  const pendiente = redondearDineroV2(saldoAntesCobro - totalPagosNuevos);
  const totalPagosVita = redondearDineroV2(pagosPrevios + totalPagosNuevos);
  const totalProcesadoAhora = redondearDineroV2(totalPagosNuevos + propina);

  return {
    ok: true as const,
    brutoConsumido,
    totalExtras,
    movilidad,
    totalAjustes,
    ventaNetaVita,
    totalCoberturas,
    pagosPrevios,
    totalPagosNuevos,
    totalPagosVita,
    saldoAntesCobro,
    pendiente,
    propina,
    totalProcesadoAhora,
    completada: pendiente === 0,
  };
}
