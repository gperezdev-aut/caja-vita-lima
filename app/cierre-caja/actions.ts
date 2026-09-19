"use server";

import { redirect } from "next/navigation";
import {
  supabaseInsert,
  supabaseSelectAllWhere,
  supabaseSelectWhere,
} from "@/lib/supabaseServer";
import { requireModuleAccess } from "@/lib/auth";
import {
  calcularCajaFisica,
  resumirDineroProcesadoCierre,
  resumirMovimientosOperativos,
  resumirSalidasCierre,
} from "@/lib/cierreCaja";

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function money(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function id(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-APP-${stamp}-${rand}`;
}

function moduleUrl(fecha: string, sede: string) {
  const params = new URLSearchParams();

  if (fecha) params.set("fecha", fecha);
  if (sede) params.set("sede", sede);

  const query = params.toString();
  return query ? `/cierre-caja?${query}` : "/cierre-caja";
}

function withError(baseUrl: string, message: string) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}error=${encodeURIComponent(message)}`;
}

export async function createCierreCajaAction(formData: FormData) {
  await requireModuleAccess("cierre-caja");

  const fecha = clean(formData.get("fecha"));
  const sede = clean(formData.get("sede"));
  const cajaInicial = money(formData.get("caja_inicial"));
  const efectivoContado = money(formData.get("efectivo_contado"));
  const fondoSiguiente = money(formData.get("pozo_fondo"));
  const responsable = clean(formData.get("responsable")) || "Gerald";
  const observacion = clean(formData.get("observacion"));

  const baseUrl = moduleUrl(fecha, sede);

  if (!fecha || !sede) {
    redirect(withError(baseUrl, "Completa fecha y sede."));
  }

  if (cajaInicial < 0 || efectivoContado < 0 || fondoSiguiente < 0) {
    redirect(withError(baseUrl, "Los montos no pueden ser negativos."));
  }

  if (fondoSiguiente > efectivoContado) {
    redirect(
      withError(
        baseUrl,
        "El fondo para el siguiente día no puede ser mayor que el efectivo contado."
      )
    );
  }

  const filtroFechaSede = [
    `fecha=eq.${fecha}`,
    `sede=eq.${encodeURIComponent(sede)}`,
  ];

  const [
    pagos,
    propinas,
    salidas,
    movimientosFondos,
    movimientos,
    cierreExistente,
  ] = await Promise.all([
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_pagos",
      ["select=metodo,monto", ...filtroFechaSede].join("&")
    ),
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_propinas",
      ["select=metodo,monto,estado", ...filtroFechaSede].join("&")
    ),
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_salidas",
      ["select=monto,metodo_salida,categoria_financiera,tipo_gasto,concepto", ...filtroFechaSede].join("&")
    ),
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_movimientos_fondos",
      ["select=tipo_movimiento,metodo,monto", ...filtroFechaSede].join("&")
    ),
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_movimientos",
      [
        "select=n_pax,estado_comprobante_manual,tipo_comprobante,estado_boleta",
        ...filtroFechaSede,
      ].join("&")
    ),
    supabaseSelectWhere<Record<string, unknown>>(
      "caja_cierres",
      [
        "select=cierre_id",
        ...filtroFechaSede,
        "estado=eq.CERRADO",
        "limit=1",
      ].join("&")
    ),
  ]);

  const lecturaError =
    pagos.error ||
    propinas.error ||
    salidas.error ||
    movimientosFondos.error ||
    movimientos.error ||
    cierreExistente.error;

  if (lecturaError) {
    redirect(withError(baseUrl, lecturaError));
  }

  if (cierreExistente.data.length > 0) {
    redirect(
      withError(
        baseUrl,
        "Ya existe un cierre CERRADO para esta fecha y sede. No se creará un cierre duplicado."
      )
    );
  }

  const dineroProcesado = resumirDineroProcesadoCierre(
    pagos.data,
    propinas.data
  );
  const totalIngresos = dineroProcesado.ingresos.total;
  const resumenSalidas = resumirSalidasCierre(
    salidas.data,
    movimientosFondos.data
  );

  if (!resumenSalidas.fisicoCalculable) {
    redirect(
      withError(
        baseUrl,
        `Hay ${resumenSalidas.salidasSinMetodo} salida(s) sin método. Clasifícalas antes de cerrar para no inventar la caja física.`
      )
    );
  }

  const { paxTotal, boletasPendientes } =
    resumirMovimientosOperativos(movimientos.data);

  const fisico = calcularCajaFisica({
    cajaInicial,
    efectivoVitaLima: dineroProcesado.ingresos.efectivo,
    efectivoPropinas: dineroProcesado.propinas.efectivo,
    totalSalidasEfectivo: resumenSalidas.totalSalidasEfectivo,
    efectivoContado,
    fondoSiguiente,
    calculable: true,
  });

  const cierreId = id("CIE");

  const cierre = await supabaseInsert("caja_cierres", {
    cierre_id: cierreId,
    fecha,
    sede,
    caja_inicial: cajaInicial,
    efectivo_contado: efectivoContado,
    pozo_fondo: fondoSiguiente,
    total_ingresos: totalIngresos,
    total_propinas: dineroProcesado.propinas.total,
    total_procesado: dineroProcesado.totalProcesado,
    propinas_por_metodo: dineroProcesado.propinas.porMetodo,
    dinero_procesado_por_metodo: dineroProcesado.porMetodo,
    total_salidas: resumenSalidas.totalGastos,
    efectivo_vita_lima: dineroProcesado.ingresos.efectivo,
    efectivo_propinas: dineroProcesado.propinas.efectivo,
    total_salidas_efectivo: resumenSalidas.totalSalidasEfectivo,
    caja_esperada: fisico.cajaEsperada,
    diferencia: fisico.diferencia,
    efectivo_a_retirar: fisico.efectivoARetirar ?? 0,
    salidas_sin_metodo: resumenSalidas.salidasSinMetodo,
    cierre_fisico_calculable: true,
    pax_total: paxTotal,
    boletas_pendientes: boletasPendientes,
    responsable,
    estado: "CERRADO",
    observacion,
  });

  if (cierre.error) {
    redirect(withError(baseUrl, cierre.error));
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  redirect(
    `${baseUrl}${separator}ok=1&id=${encodeURIComponent(cierreId)}`
  );
}
