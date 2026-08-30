"use server";

import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function missingEnvRedirect() {
  redirect(
    "/comprobantes?error=Faltan variables de entorno: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY."
  );
}

async function patchMovimientoComprobante(
  movimientoId: string,
  payload: Record<string, unknown>
) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    missingEnvRedirect();
  }

  const endpoint = `${supabaseUrl}/rest/v1/caja_movimientos?movimiento_id=eq.${encodeURIComponent(
    movimientoId
  )}`;

  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    redirect(
      `/comprobantes?error=${encodeURIComponent(
        `Supabase respondió ${response.status}: ${detail || response.statusText}`
      )}`
    );
  }
}

export async function updateComprobanteAction(formData: FormData) {
  await requireModuleAccess("comprobantes");

  const movimientoId = clean(formData.get("movimiento_id"));
  const tipoComprobante = clean(formData.get("tipo_comprobante"));
  const estadoComprobante = clean(formData.get("estado_comprobante_manual"));
  const numeroComprobante = clean(formData.get("numero_comprobante_final"));
  const fechaEmision = clean(formData.get("fecha_emision_comprobante"));
  const observacionComprobante = clean(formData.get("observacion_comprobante"));
  const revisadoPor = clean(formData.get("comprobante_revisado_por")) || "Gerald";

  if (!movimientoId) {
    redirect("/comprobantes?error=Falta el ID del movimiento.");
  }

  if (!tipoComprobante || !estadoComprobante) {
    redirect(
      `/comprobantes?error=${encodeURIComponent(
        "Selecciona tipo de comprobante y estado."
      )}`
    );
  }

  await patchMovimientoComprobante(movimientoId, {
    tipo_comprobante: tipoComprobante || null,
    estado_comprobante_manual: estadoComprobante || null,
    numero_comprobante_final: numeroComprobante || null,
    fecha_emision_comprobante: fechaEmision || null,
    observacion_comprobante: observacionComprobante || null,
    comprobante_revisado_por: revisadoPor,
    comprobante_revisado_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  redirect(`/comprobantes?ok=1&id=${encodeURIComponent(movimientoId)}`);
}
