"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";

function cleanText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function cleanDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export async function updateClienteCrmAction(formData: FormData) {
  await requireModuleAccess("clientes");

  const clienteId = String(formData.get("cliente_id") ?? "").trim();

  if (!clienteId) {
    redirect("/clientes?error=cliente_id");
  }

  const cliente = cleanText(formData.get("cliente"));

  if (!cliente) {
    redirect(`/clientes/${encodeURIComponent(clienteId)}?error=cliente`);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    redirect(`/clientes/${encodeURIComponent(clienteId)}?error=config`);
  }

  const payload = {
    cliente,
    whatsapp: cleanText(formData.get("whatsapp")),
    dni: cleanText(formData.get("dni")),
    email: cleanText(formData.get("email")),
    telefono_alternativo: cleanText(formData.get("telefono_alternativo")),
    fecha_nacimiento: cleanDate(formData.get("fecha_nacimiento")),
    cliente_potencial: cleanText(formData.get("cliente_potencial")),
    segmento_cliente: cleanText(formData.get("segmento_cliente")),
    etiquetas_crm: cleanText(formData.get("etiquetas_crm")),
    preferencias_atencion: cleanText(formData.get("preferencias_atencion")),
    alerta_atencion: cleanText(formData.get("alerta_atencion")),
    notas: cleanText(formData.get("notas")),
    consentimiento_whatsapp: formData.get("consentimiento_whatsapp") === "on",
    updated_at: new Date().toISOString(),
  };

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/clientes?cliente_id=eq.${encodeURIComponent(clienteId)}`,
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

  if (!response.ok) {
    redirect(`/clientes/${encodeURIComponent(clienteId)}?error=save`);
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);

  redirect(`/clientes/${encodeURIComponent(clienteId)}?updated=1`);
}
