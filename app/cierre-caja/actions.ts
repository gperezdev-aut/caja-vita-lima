"use server";

import { redirect } from "next/navigation";
import { supabaseInsert } from "@/lib/supabaseServer";

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function money(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function intValue(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
  const fecha = clean(formData.get("fecha"));
  const sede = clean(formData.get("sede"));
  const cajaInicial = money(formData.get("caja_inicial"));
  const efectivoContado = money(formData.get("efectivo_contado"));
  const pozoFondo = money(formData.get("pozo_fondo"));
  const totalIngresos = money(formData.get("total_ingresos"));
  const totalSalidas = money(formData.get("total_salidas"));
  const paxTotal = intValue(formData.get("pax_total"));
  const boletasPendientes = intValue(formData.get("boletas_pendientes"));
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
    pozoFondo < 0 ||
    totalIngresos < 0 ||
    totalSalidas < 0
  ) {
    redirect(`${baseUrl}${separator}error=${encodeURIComponent("Los montos no pueden ser negativos.")}`);
  }

  const cajaEsperada = cajaInicial + totalIngresos - totalSalidas;
  const diferencia = efectivoContado + pozoFondo - cajaEsperada;
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
