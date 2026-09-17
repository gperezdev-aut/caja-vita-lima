"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseUpsert } from "@/lib/supabaseServer";

function time(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? `${raw}:00` : null;
}

export async function updateHorarioHabitualAction(formData: FormData) {
  const session = await requireModuleAccess("terapistas");
  const terapistaId = String(formData.get("terapista_id") ?? "").trim();

  if (!terapistaId) redirect("/terapistas?error=terapista_id");
  if (session.rol !== "ADMIN_GERALD" && session.rol !== "SOCIO") {
    redirect(`/terapistas/${encodeURIComponent(terapistaId)}/horario?error=sin_permisos`);
  }

  const now = new Date().toISOString();
  const rows = Array.from({ length: 7 }, (_, index) => {
    const dia = index + 1;
    const trabaja = formData.get(`trabaja_${dia}`) === "on";
    const horaInicio = trabaja ? time(formData.get(`hora_inicio_${dia}`)) : null;
    const horaFin = trabaja ? time(formData.get(`hora_fin_${dia}`)) : null;
    const sede = String(formData.get(`sede_${dia}`) ?? "").trim() || null;
    const observacion = String(formData.get(`observacion_${dia}`) ?? "").trim() || null;

    if (trabaja && (!horaInicio || !horaFin || horaFin <= horaInicio)) {
      redirect(`/terapistas/${encodeURIComponent(terapistaId)}/horario?error=horas&dia=${dia}`);
    }

    return {
      terapista_id: terapistaId,
      dia_semana: dia,
      trabaja,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      sede,
      observacion,
      updated_at: now,
    };
  });

  const result = await supabaseUpsert(
    "terapista_horario_habitual",
    rows,
    "terapista_id,dia_semana"
  );

  if (result.error) {
    redirect(`/terapistas/${encodeURIComponent(terapistaId)}/horario?error=save`);
  }

  revalidatePath("/horarios");
  revalidatePath(`/terapistas/${terapistaId}`);
  revalidatePath(`/terapistas/${terapistaId}/horario`);
  redirect(`/terapistas/${encodeURIComponent(terapistaId)}/horario?updated=1`);
}
