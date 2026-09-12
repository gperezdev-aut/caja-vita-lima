"use server";

import { revalidatePath } from "next/cache";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseRpc } from "@/lib/supabaseServer";

export type AtencionReservadaState = {
  ok: boolean;
  error?: string;
  mensaje?: string;
  completada?: boolean;
  pendiente?: number;
};

export const INITIAL_ATENCION_RESERVADA_STATE: AtencionReservadaState = {
  ok: false,
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function errorAmigable(error: string) {
  if (error.includes("REQUEST_ID_PAYLOAD_CONFLICTO")) {
    return "Este intento ya se procesó con datos diferentes. Vuelve a Citas de hoy y abre la atención otra vez.";
  }
  if (error.includes("RESERVA_MOVIMIENTO_NO_RELACIONADOS")) {
    return "La reserva no pertenece a este movimiento. No se realizó ningún cambio.";
  }
  if (error.includes("MOVIMIENTO_LEDGER_DESCUADRADO")) {
    return "Los pagos previos no cuadran con el movimiento. Revisa el caso antes de cobrar.";
  }
  if (error.includes("ATENCION_YA_COMPLETADA")) {
    return "Esta atención ya fue completada.";
  }
  if (error.includes("EXTRAS_NO_SOPORTADOS")) {
    return "Los extras aún no cuentan con un registro auditable y no se pueden añadir desde este flujo.";
  }
  if (error.includes("PAGO_FINAL_SUPERA_PENDIENTE")) {
    return "El pago ingresado supera el saldo pendiente guardado.";
  }
  if (error.includes("NUMERO_OPERACION_REQUERIDO")) {
    return "Ingresa el número de operación para el método elegido.";
  }
  return "No se pudo confirmar la atención. La transacción no guardó cambios parciales.";
}

export async function guardarAtencionReservadaAction(
  _previousState: AtencionReservadaState,
  formData: FormData
): Promise<AtencionReservadaState> {
  void _previousState;
  const session = await requireModuleAccess("citas-hoy");
  const requestId = text(formData, "request_id");
  const movimientoId = text(formData, "movimiento_id");
  const reservaId = text(formData, "reserva_id");
  const personas = Number.parseInt(text(formData, "personas"), 10);
  const pago = Number(text(formData, "pago_restante").replace(",", "."));

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return { ok: false, error: "El identificador del intento no es válido. Recarga el flujo." };
  }
  if (!movimientoId || !reservaId || !Number.isInteger(personas) || personas < 1 || personas > 5) {
    return { ok: false, error: "La reserva no tiene datos suficientes para iniciar la atención." };
  }
  if (!Number.isFinite(pago) || pago < 0) {
    return { ok: false, error: "Ingresa un pago válido, incluso 0 si no corresponde cobrar." };
  }

  const terapistas = Array.from({ length: personas }, (_, index) => ({
    persona: index + 1,
    terapista: text(formData, `terapista_${index + 1}`),
    terapista_otro: text(formData, `terapista_otro_${index + 1}`) || null,
  }));
  if (terapistas.some((item) => !item.terapista)) {
    return { ok: false, error: "Asigna una terapista a cada persona." };
  }

  const rpc = await supabaseRpc<{
    ok: boolean;
    completada: boolean;
    pendiente: number;
    reutilizado: boolean;
  }>("iniciar_o_cerrar_atencion_reservada_v1", {
    p_payload: {
      request_id: requestId,
      movimiento_id: movimientoId,
      reserva_id: reservaId,
      terapistas,
      pago_restante: pago,
      metodo_pago: text(formData, "metodo_pago"),
      numero_operacion: text(formData, "numero_operacion"),
      extras: [],
      observacion: text(formData, "observacion"),
      responsable: session.nombre,
    },
  });

  if (rpc.error || !rpc.data?.ok) {
    return { ok: false, error: errorAmigable(rpc.error ?? "") };
  }

  revalidatePath("/citas-hoy");
  revalidatePath(`/citas-hoy/${encodeURIComponent(movimientoId)}/atencion`);
  return {
    ok: true,
    completada: rpc.data.completada,
    pendiente: Number(rpc.data.pendiente ?? 0),
    mensaje: rpc.data.completada
      ? "Atención completada y pago conciliado."
      : "Atención iniciada. Queda saldo pendiente y no se marcó como completada.",
  };
}
