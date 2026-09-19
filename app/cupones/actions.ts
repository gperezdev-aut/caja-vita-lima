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

export async function validarCuponConvenioAction(
  _previousState: CuponActionState = INITIAL_STATE,
  formData: FormData
): Promise<CuponActionState> {
  void _previousState;
  const session = await requireModuleAccess("cupones");

  const registroId = text(formData, "registro_id");
  const serviceCode = text(formData, "service_code");
  const montoReconocido = Number(text(formData, "monto_reconocido").replace(",", "."));

  if (!registroId || !serviceCode) {
    return { ok: false, error: "Selecciona el servicio antes de validar el cupón." };
  }
  if (!Number.isFinite(montoReconocido) || montoReconocido <= 0) {
    return { ok: false, error: "Ingresa un monto reconocido válido mayor a cero." };
  }

  const rpc = await supabaseRpc<{ ok: boolean; reutilizado?: boolean }>(
    "caja_validar_cupon_convenio_v1",
    {
      p_registro_id: registroId,
      p_service_code: serviceCode,
      p_monto_reconocido: montoReconocido,
      p_responsable: session.nombre,
    }
  );

  if (rpc.error || !rpc.data?.ok) {
    const error = rpc.error ?? "";
    if (error.includes("CUPON_YA_VERIFICADO")) {
      return { ok: false, error: "Este cupón ya fue verificado y no puede cambiarse desde Operación." };
    }
    if (error.includes("HORARIO_NO_CABE_SERVICIO")) {
      return { ok: false, error: "El servicio comprado no cabe en el horario reservado. Ajusta primero la cita." };
    }
    if (error.includes("CUPON_SIN_FICHA_COMPLETA")) {
      return { ok: false, error: "La ficha del cliente todavía no está completa." };
    }
    if (error.includes("SERVICIO_CONVENIO_INVALIDO")) {
      return { ok: false, error: "Ese servicio no es válido para una atención de convenio." };
    }
    return { ok: false, error: "No se pudo validar el cupón. No se aplicó ningún cambio parcial." };
  }

  revalidatePath("/cupones");
  revalidatePath("/citas-hoy");

  return {
    ok: true,
    message: rpc.data.reutilizado
      ? "El cupón ya estaba validado con esos mismos datos."
      : "Cupón verificado. La cita ya tiene servicio y cobertura reconocida.",
  };
}
