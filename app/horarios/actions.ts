"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseUpsert } from "@/lib/supabaseServer";

const TIPOS = new Set([
  "DESCANSO",
  "CAMBIO_HORARIO",
  "FALTA",
  "RECUPERACION",
  "VACACIONES",
  "REUNION",
  "APOYO",
]);

function text(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return result || null;
}

function date(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function time(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(result) ? result : null;
}

function canManage(role: string) {
  return role === "ADMIN_GERALD" || role === "SOCIO";
}

function monthFromDate(fecha: string | null) {
  return fecha ? fecha.slice(0, 7) : "";
}

function errorPath(month: string, code: string) {
  const suffix = month ? `?mes=${encodeURIComponent(month)}&error=${encodeURIComponent(code)}` : `?error=${encodeURIComponent(code)}`;
  return `/horarios${suffix}`;
}

async function deleteException(terapistaId: string, fecha: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return { error: "config" };

  try {
    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/terapista_horario_excepciones?terapista_id=eq.${encodeURIComponent(terapistaId)}&fecha=eq.${encodeURIComponent(fecha)}`;
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      cache: "no-store",
    });

    if (!response.ok) return { error: "delete" };
    return { error: null };
  } catch {
    return { error: "delete" };
  }
}

export async function saveHorarioExcepcionAction(formData: FormData) {
  const session = await requireModuleAccess("horarios");
  const terapistaId = String(formData.get("terapista_id") ?? "").trim();
  const fecha = date(formData.get("fecha"));
  const tipo = String(formData.get("tipo") ?? "").trim().toUpperCase();
  const month = monthFromDate(fecha);

  if (!canManage(session.rol)) redirect(errorPath(month, "sin_permisos"));
  if (!terapistaId || !fecha || !TIPOS.has(tipo)) redirect(errorPath(month, "datos"));

  const trabaja = ["CAMBIO_HORARIO", "RECUPERACION", "APOYO"].includes(tipo);
  const horaInicio = trabaja ? time(formData.get("hora_inicio")) : null;
  const horaFin = trabaja ? time(formData.get("hora_fin")) : null;

  if (trabaja && (!horaInicio || !horaFin || horaFin <= horaInicio)) {
    redirect(errorPath(month, "horas"));
  }

  const now = new Date().toISOString();
  const result = await supabaseUpsert(
    "terapista_horario_excepciones",
    {
      terapista_id: terapistaId,
      fecha,
      tipo,
      trabaja,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      sede: trabaja ? text(formData.get("sede")) : null,
      observacion: text(formData.get("observacion")),
      updated_at: now,
    },
    "terapista_id,fecha"
  );

  if (result.error) redirect(errorPath(month, "save"));

  revalidatePath("/horarios");
  revalidatePath(`/terapistas/${terapistaId}/horario`);
  redirect(`/horarios?mes=${encodeURIComponent(month)}&updated=1`);
}

export async function deleteHorarioExcepcionAction(formData: FormData) {
  const session = await requireModuleAccess("horarios");
  const terapistaId = String(formData.get("terapista_id") ?? "").trim();
  const fecha = date(formData.get("fecha"));
  const month = monthFromDate(fecha);

  if (!canManage(session.rol)) redirect(errorPath(month, "sin_permisos"));
  if (!terapistaId || !fecha) redirect(errorPath(month, "datos"));

  const result = await deleteException(terapistaId, fecha);
  if (result.error) redirect(errorPath(month, result.error));

  revalidatePath("/horarios");
  revalidatePath(`/terapistas/${terapistaId}/horario`);
  redirect(`/horarios?mes=${encodeURIComponent(month)}&deleted=1`);
}
