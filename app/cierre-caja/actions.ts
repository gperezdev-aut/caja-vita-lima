"use server";

import { redirect } from "next/navigation";
import { supabaseInsert, supabaseSelectAllWhere } from "@/lib/supabaseServer";
import { requireModuleAccess } from "@/lib/auth";
import {
  resumirMovimientosOperativos,
  resumirPagosCierre,
  sumarSalidas,
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

export async function createCierreCajaAction(formData: FormData) {
  await requireModuleAccess("cierre-caja");

  const fecha = clean(formData.get("fecha"));
  const sede = clean(formData.get("sede"));
  const cajaInicial = money(formData.get("caja_inicial"));
  const efectivoContado = money(formData.get("efectivo_contado"));
  const pozoFondo = money(formData.get("pozo_fondo"));
  const responsable = clean(formData.get("responsable")) || "Gerald";
  const observacion = clean(formData.get("observacion"));

  const baseUrl = moduleUrl(fecha, sede);
  const separator = baseUrl.includes("?") ? "&" : "?";

  if (!fecha || !sede) {
    redirect(`${baseUrl}${separator}error=${encodeURIComponent("Completa fecha y sede.")}`);
  }

  if (
    cajaInicial < 0 ||
    efectivoContado < 0 ||
    pozoFondo < 0
  ) {
    redirect(`${baseUrl}${separator}error=${encodeURIComponent("Los montos no pueden ser negativos.")}`);
  }

  const filtroFechaSede = [
    `fecha=eq.${fecha}`,
    `sede=eq.${encodeURIComponent(sede)}`,
  ];
  const [pagos, salidas, movimientos] = await Promise.all([
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_pagos",
      ["select=metodo,monto", ...filtroFechaSede].join("&")
    ),
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_salidas",
      ["select=monto", ...filtroFechaSede].join("&")
    ),
    supabaseSelectAllWhere<Record<string, unknown>>(
      "caja_movimientos",
      [
        "select=n_pax,estado_comprobante_manual,tipo_comprobante,estado_boleta",
        ...filtroFechaSede,
      ].join("&")
    ),
  ]);

  const lecturaError = pagos.error || salidas.error || movimientos.error;
  if (lecturaError) {
    redirect(`${baseUrl}${separator}error=${encodeURIComponent(lecturaError)}`);
  }

  // Los importes automáticos se recalculan server-side. Los valores visibles
  // del formulario no son parte del contrato financiero de escritura.
  const totalIngresos = resumirPagosCierre(pagos.data).total;
  const totalSalidas = sumarSalidas(salidas.data);
  const { paxTotal, boletasPendientes } = resumirMovimientosOperativos(movimientos.data);

  // Compatibilidad con caja_cierres: esta fórmula representa saldo operativo.
  // No se presenta como caja física porque caja_salidas aún no guarda método.
  const cajaEsperada = cajaInicial + pozoFondo + totalIngresos - totalSalidas;
  const diferencia = efectivoContado - cajaEsperada;
  const cierreId = id("CIE");

  const cierre = await supabaseInsert("caja_cierres", {
    cierre_id: cierreId,
    fecha,
    sede,
    caja_inicial: cajaInicial,
    efectivo_contado: efectivoContado,
    pozo_fondo: pozoFondo,
    total_ingresos: totalIngresos,
    total_salidas: totalSalidas,
    caja_esperada: cajaEsperada,
    diferencia,
    pax_total: paxTotal,
    boletas_pendientes: boletasPendientes,
    responsable,
    estado: "CERRADO",
    observacion,
  });

  if (cierre.error) {
    redirect(`${baseUrl}${separator}error=${encodeURIComponent(cierre.error)}`);
  }

  redirect(`${baseUrl}${separator}ok=1&id=${encodeURIComponent(cierreId)}`);
}
