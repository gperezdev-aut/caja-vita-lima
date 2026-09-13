"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/auth";
import { supabaseRpc } from "@/lib/supabaseServer";

export type GiftCardActionState = {
  ok: boolean;
  error?: string;
  giftcardId?: string;
  code?: string;
  issuedAt?: string;
  expiresAt?: string;
  reused?: boolean;
};

type RpcResult = {
  ok?: boolean;
  reutilizado?: boolean;
  giftcard_id?: string;
  codigo?: string;
  fecha_emision?: string;
  fecha_vencimiento?: string;
};

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function optionalPhone(value: FormDataEntryValue | null) {
  const raw = clean(value);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 9) return `+51${digits}`;
  return `+${digits}`;
}

function errorMessage(error: string) {
  const known: Record<string, string> = {
    REQUEST_ID_PAYLOAD_CONFLICTO: "Este intento ya se usó con datos diferentes. Recarga el módulo.",
    SERVICIO_CANONICO_NO_DISPONIBLE: "El servicio ya no está disponible en el catálogo activo.",
    GIFT_CARD_REQUIERE_PAGO_TOTAL: "La Gift Card debe pagarse por completo al emitirla.",
    NUMERO_OPERACION_REQUERIDO: "Ingresa el número de operación para este método de pago.",
    METODO_PAGO_NO_PERMITIDO: "El método de pago no está habilitado en Caja.",
    SALDO_INSUFICIENTE: "El monto supera el saldo disponible.",
    GIFT_CARD_VENCIDA: "La Gift Card está vencida y no puede canjearse.",
    GIFT_CARD_ANULADA: "La Gift Card está anulada.",
    GIFT_CARD_USADA: "La Gift Card ya fue usada por completo.",
  };
  const key = Object.keys(known).find((item) => error.includes(item));
  return key ? known[key] : error;
}

export async function emitirGiftCardAction(
  _state: GiftCardActionState,
  formData: FormData,
): Promise<GiftCardActionState> {
  const session = await requireModuleAccess("gift-cards");
  const requestId = clean(formData.get("request_id"));
  const type = clean(formData.get("tipo"));
  const buyer = clean(formData.get("comprador"));
  const beneficiary = clean(formData.get("beneficiario"));
  const value = Number(clean(formData.get("monto")) || 0);
  const received = Number(clean(formData.get("monto_recibido")) || 0);

  if (!requestId || !buyer || !beneficiary || !["SERVICIO", "MONTO"].includes(type)) {
    return { ok: false, error: "Completa tipo, comprador y beneficiario." };
  }
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(received)) {
    return { ok: false, error: "Revisa el valor y el monto recibido." };
  }

  const response = await supabaseRpc<RpcResult>("emitir_gift_card_v1", {
    p_payload: {
      request_id: requestId,
      tipo: type,
      comprador: buyer,
      comprador_cliente_id: clean(formData.get("comprador_cliente_id")) || null,
      whatsapp_comprador: optionalPhone(formData.get("whatsapp_comprador")) || null,
      beneficiario: beneficiary,
      whatsapp_beneficiario: optionalPhone(formData.get("whatsapp_beneficiario")) || null,
      dedicatoria: clean(formData.get("dedicatoria")) || null,
      service_code: clean(formData.get("service_code")) || null,
      monto: value,
      sede: clean(formData.get("sede")),
      metodo_pago: clean(formData.get("metodo_pago")),
      numero_operacion: clean(formData.get("numero_operacion")) || null,
      monto_recibido: received,
      responsable: session.nombre,
    },
  });

  if (response.error || !response.data?.giftcard_id || !response.data.codigo) {
    return { ok: false, error: errorMessage(response.error || "No se pudo emitir la Gift Card.") };
  }

  revalidatePath("/gift-cards");
  return {
    ok: true,
    giftcardId: response.data.giftcard_id,
    code: response.data.codigo,
    issuedAt: response.data.fecha_emision,
    expiresAt: response.data.fecha_vencimiento,
    reused: response.data.reutilizado,
  };
}

export async function canjearGiftCardAction(formData: FormData) {
  const session = await requireModuleAccess("gift-cards");
  const code = clean(formData.get("codigo"));
  const response = await supabaseRpc("canjear_gift_card_v1", {
    p_payload: {
      request_id: clean(formData.get("request_id")),
      codigo: code,
      monto_usado: Number(clean(formData.get("monto_usado")) || 0),
      responsable: session.nombre,
      movimiento_id: clean(formData.get("movimiento_id")) || null,
      reserva_id: clean(formData.get("reserva_id")) || null,
      atencion_movimiento_id: clean(formData.get("atencion_movimiento_id")) || null,
      observacion: clean(formData.get("observacion")) || null,
    },
  });
  if (response.error) redirect(`/gift-cards?error=${encodeURIComponent(errorMessage(response.error))}`);
  revalidatePath("/gift-cards");
  redirect(`/gift-cards?ok=canje&codigo=${encodeURIComponent(code)}`);
}

export async function anularGiftCardAction(formData: FormData) {
  const session = await requireModuleAccess("gift-cards");
  if (session.rol !== "ADMIN_GERALD") {
    redirect("/gift-cards?error=Solo el administrador puede anular Gift Cards.");
  }
  const code = clean(formData.get("codigo"));
  const response = await supabaseRpc("anular_gift_card_v1", {
    p_payload: {
      codigo: code,
      motivo: clean(formData.get("motivo")),
      responsable: session.nombre,
    },
  });
  if (response.error) redirect(`/gift-cards?error=${encodeURIComponent(errorMessage(response.error))}`);
  revalidatePath("/gift-cards");
  redirect(`/gift-cards?ok=anulada&codigo=${encodeURIComponent(code)}`);
}
