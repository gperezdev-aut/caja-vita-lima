"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseUpsert } from "@/lib/supabaseServer";

function text(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return result || null;
}

function date(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function integer(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: FormDataEntryValue | null) {
  const parsed = integer(value);
  return parsed && parsed > 0 ? parsed : null;
}

function errorPath(terapistaId: string, code: string) {
  return `/terapistas/${encodeURIComponent(terapistaId)}?error=${encodeURIComponent(code)}`;
}

async function updateTerapistaMaster(terapistaId: string, payload: Record<string, unknown>) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { error: "config" };
  }

  try {
    // El maestro usa PATCH deliberadamente: no se permite renombrar la terapista
    // desde esta ficha y así no se arriesgan config_listas ni referencias históricas.
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/terapistas?terapista_id=eq.${encodeURIComponent(terapistaId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      }
    );

    if (!response.ok) return { error: "save" };
    return { error: null };
  } catch {
    return { error: "save" };
  }
}

export async function updateTerapistaFichaAction(formData: FormData) {
  const session = await requireModuleAccess("terapistas");
  const terapistaId = String(formData.get("terapista_id") ?? "").trim();

  if (!terapistaId) redirect("/terapistas?error=terapista_id");
  if (session.rol !== "ADMIN_GERALD") redirect(errorPath(terapistaId, "sin_permisos"));

  const dni = text(formData.get("dni"));
  const ruc = text(formData.get("ruc"));
  const codigoMarcacion = text(formData.get("codigo_marcacion"));

  if (dni && !/^\d{8}$/.test(dni)) redirect(errorPath(terapistaId, "dni"));
  if (ruc && !/^\d{11}$/.test(ruc)) redirect(errorPath(terapistaId, "ruc"));
  if (codigoMarcacion && !/^\d{4}$/.test(codigoMarcacion)) {
    redirect(errorPath(terapistaId, "codigo_marcacion"));
  }

  const now = new Date().toISOString();
  const llavesRaw = String(formData.get("llaves") ?? "").trim();
  const llaves = llavesRaw === "SI" ? true : llavesRaw === "NO" ? false : null;

  const masterResult = await updateTerapistaMaster(terapistaId, {
    telefono: text(formData.get("telefono")),
    sede_habitual: text(formData.get("sede_habitual")),
    fecha_ingreso: date(formData.get("fecha_ingreso")),
    observacion: text(formData.get("observacion")),
    updated_at: now,
  });

  if (masterResult.error) redirect(errorPath(terapistaId, masterResult.error));

  const operaciones = await Promise.all([
    supabaseUpsert(
      "terapista_datos_personales",
      {
        terapista_id: terapistaId,
        nombre_completo: text(formData.get("nombre_completo")),
        direccion: text(formData.get("direccion")),
        fecha_nacimiento: date(formData.get("fecha_nacimiento")),
        dni,
        ruc,
        estado_civil: text(formData.get("estado_civil")),
        hijos: integer(formData.get("hijos")),
        correo: text(formData.get("correo")),
        contacto_emergencia: text(formData.get("contacto_emergencia")),
        telefono_emergencia: text(formData.get("telefono_emergencia")),
        relacion_contacto: text(formData.get("relacion_contacto")),
        updated_at: now,
      },
      "terapista_id"
    ),
    supabaseUpsert(
      "terapista_datos_laborales",
      {
        terapista_id: terapistaId,
        codigo_marcacion: codigoMarcacion,
        llaves,
        observacion_laboral: text(formData.get("observacion_laboral")),
        updated_at: now,
      },
      "terapista_id"
    ),
    supabaseUpsert(
      "terapista_datos_pago",
      {
        terapista_id: terapistaId,
        banco: text(formData.get("banco")),
        cuenta_soles: text(formData.get("cuenta_soles")),
        afp: text(formData.get("afp")),
        updated_at: now,
      },
      "terapista_id"
    ),
    supabaseUpsert(
      "terapista_uniforme",
      [
        {
          terapista_id: terapistaId,
          prenda: "Pantalón",
          talla: text(formData.get("uniforme_pantalon_talla")),
          cantidad: positiveInteger(formData.get("uniforme_pantalon_cantidad")),
          updated_at: now,
        },
        {
          terapista_id: terapistaId,
          prenda: "Chaqueta",
          talla: text(formData.get("uniforme_chaqueta_talla")),
          cantidad: positiveInteger(formData.get("uniforme_chaqueta_cantidad")),
          updated_at: now,
        },
        {
          terapista_id: terapistaId,
          prenda: "Casaca",
          talla: text(formData.get("uniforme_casaca_talla")),
          cantidad: positiveInteger(formData.get("uniforme_casaca_cantidad")),
          updated_at: now,
        },
      ],
      "terapista_id,prenda"
    ),
  ]);

  const failed = operaciones.find((result) => result.error);
  if (failed?.error) redirect(errorPath(terapistaId, "save"));

  revalidatePath("/terapistas");
  revalidatePath(`/terapistas/${terapistaId}`);
  redirect(`/terapistas/${encodeURIComponent(terapistaId)}?updated=1`);
}
