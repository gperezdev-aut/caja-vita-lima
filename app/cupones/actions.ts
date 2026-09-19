"use server";

import { revalidatePath } from "next/cache";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseRpc } from "@/lib/supabaseServer";

export type CuponActionState = {
  ok: boolean;
  error?: string;
  message?: string;
};

const INITIAL_STATE: CuponActionState = { ok: false };

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function asignarBeneficioConvenioAction(
  _previousState: CuponActionState = INITIAL_STATE,
  formData: FormData
): Promise<CuponActionState> {
  void _previousState;
  const session = await requireModuleAccess("cupones");

  const registroId = text(formData, "registro_id");
  const beneficioCode = text(formData, "beneficio_code");

  if (!registroId || !beneficioCode) {
    return { ok: false, error: "Selecciona el beneficio comprado por el cliente." };
  }

  const rpc = await supabaseRpc<{
    ok: boolean;
    beneficio?: string;
    duracion_min?: number;
    sesiones_total?: number;
  }>(
    "caja_asignar_beneficio_convenio_v1",
    {
      p_registro_id: registroId,
      p_beneficio_code: beneficioCode,
      p_responsable: session.nombre,
    }
  );

  if (rpc.error || !rpc.data?.ok) {
    const error = rpc.error ?? "";
    if (error.includes("HORARIO_NO_CABE_SERVICIO")) {
      return { ok: false, error: "El beneficio no cabe en el horario reservado. Ajusta primero la cita." };
    }
    if (error.includes("BENEFICIO_SEDE_NO_COINCIDE")) {
      return { ok: false, error: "Ese beneficio no aplica para la sede reservada." };
    }
    if (error.includes("CUPON_SIN_FICHA_COMPLETA")) {
      return { ok: false, error: "La ficha del cliente todavía no está completa." };
    }
    if (error.includes("BENEFICIO_CONVENIO_INVALIDO")) {
      return { ok: false, error: "Ese beneficio no corresponde al proveedor del cupón." };
    }
    if (error.includes("CONVENIO_YA_CANJEADO")) {
      return { ok: false, error: "Este cupón ya fue canjeado y no puede cambiarse." };
    }
    return { ok: false, error: "No se pudo guardar el beneficio. No se aplicó ningún cambio parcial." };
  }

  revalidatePath("/cupones");
  revalidatePath("/citas-hoy");

  return {
    ok: true,
    message: `Servicio guardado: ${rpc.data.beneficio ?? "beneficio de convenio"} · ${Number(rpc.data.duracion_min ?? 0)} min${Number(rpc.data.sesiones_total ?? 1) > 1 ? ` · ${rpc.data.sesiones_total} sesiones` : ""}. Los cálculos económicos quedan pendientes para una fase posterior.`,
  };
}
