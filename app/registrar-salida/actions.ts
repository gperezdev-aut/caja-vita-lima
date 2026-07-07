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

function id(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-APP-${stamp}-${rand}`;
}

export async function createSalidaAction(formData: FormData) {
  const fecha = clean(formData.get("fecha"));
  const hora = clean(formData.get("hora"));
  const sede = clean(formData.get("sede"));
  const tipoGasto = clean(formData.get("tipo_gasto"));
  const concepto = clean(formData.get("concepto"));
  const monto = money(formData.get("monto"));
  const responsable = clean(formData.get("responsable")) || "Gerald";
  const sourceMovimientoId = clean(formData.get("source_movimiento_id"));
  const observacion = clean(formData.get("observacion"));

  if (!fecha || !hora || !sede || !tipoGasto || !concepto) {
    redirect(
      "/registrar-salida?error=Completa fecha, hora, sede, tipo de gasto y concepto."
    );
  }

  if (monto < 0) {
    redirect("/registrar-salida?error=El monto no puede ser negativo.");
  }

  const salidaId = id("SAL");

  const salida = await supabaseInsert("caja_salidas", {
    salida_id: salidaId,
    fecha,
    hora,
    sede,
    tipo_gasto: tipoGasto,
    concepto,
    monto,
    responsable,
    source_movimiento_id: sourceMovimientoId || null,
    observacion,
  });

  if (salida.error) {
    redirect(`/registrar-salida?error=${encodeURIComponent(salida.error)}`);
  }

  redirect(`/registrar-salida?ok=1&id=${encodeURIComponent(salidaId)}`);
}
