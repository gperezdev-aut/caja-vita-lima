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
  totalCobrar?: number;
  totalPagado?: number;
  coberturasTotales?: number;
  propinaRegistrada?: number;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function parseJson<T>(formData: FormData, name: string, fallback: T): T | null {
  const raw = text(formData, name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function errorAmigable(error: string) {
  const pairs: Array<[string, string]> = [
    ["REQUEST_ID_PAYLOAD_CONFLICTO", "Este intento ya se procesó con datos diferentes. Vuelve a abrir la atención."],
    ["RESERVA_MOVIMIENTO_NO_RELACIONADOS", "La reserva no pertenece a este movimiento. No se realizó ningún cambio."],
    ["MOVIMIENTO_LEDGER_DESCUADRADO", "Los pagos previos no cuadran con el movimiento. Revisa el caso antes de cobrar."],
    ["ATENCION_YA_COMPLETADA", "Esta atención ya fue completada."],
    ["PAGOS_SUPERAN_PENDIENTE", "Los pagos ingresados superan el saldo disponible después de coberturas."],
    ["NUMERO_OPERACION_REQUERIDO", "Ingresa el número de operación para cada pago no efectivo."],
    ["GIFT_CARD_COBERTURA_REQUERIDA", "Esta reserva tiene una Gift Card activa y debe incluirse en la conciliación."],
    ["GIFT_CARD_HOLD_NO_COINCIDE", "La cobertura de la Gift Card ya no coincide con su reserva. No se guardaron cambios."],
    ["GIFT_CARD_NO_CANJEABLE", "La Gift Card ya no está disponible para canje."],
    ["CONVENIO_NO_EXISTE", "No se encontró el registro del convenio indicado."],
    ["CONVENIO_PLATAFORMA_NO_COINCIDE", "El convenio indicado no corresponde a Bee Beneficios o Cuponidad según la selección."],
    ["CONVENIO_MONTO_NO_COINCIDE", "El monto de cobertura no coincide con el monto reconocido del convenio."],
    ["AJUSTES_SUPERAN_TOTAL", "Los descuentos o cortesías superan el total cobrable de la atención."],
    ["COBERTURAS_O_PAGOS_SUPERAN_TOTAL", "Pagos y coberturas superarían el total de la atención."],
    ["PROPINA_DISTRIBUCION_NO_CUADRA", "La distribución de la propina debe sumar exactamente el monto de la propina."],
    ["DISTRIBUCION_PROPINA_INVALIDA", "La propina contiene una terapista o un importe no válido."],
    ["TERAPISTA_PROPINA_DUPLICADA", "Una terapista aparece más de una vez en la distribución de la propina."],
    ["METODO_PROPINA_NO_PERMITIDO", "El método usado para la propina no está configurado en Caja."],
    ["NUMERO_OPERACION_PROPINA_REQUERIDO", "Ingresa el número de operación de la propina no efectiva."],
    ["EXTRA_INVALIDO", "Revisa el extra: concepto, importe, cantidad y duración deben ser válidos."],
    ["AJUSTE_INVALIDO", "Revisa el descuento o ajuste e indica un motivo."],
    ["COBERTURA_INVALIDA", "La cobertura ingresada no es válida."],
    ["PAGO_INVALIDO", "Revisa los importes de los pagos ingresados."],
    ["METODO_PAGO_NO_PERMITIDO", "Uno de los métodos de pago no está configurado en Caja."],
  ];
  for (const [code, message] of pairs) if (error.includes(code)) return message;
  return "No se pudo conciliar la atención. La transacción no guardó cambios parciales.";
}

type ExtraPayload = {
  tipo: string;
  concepto: string;
  cantidad: number;
  monto_unitario: number;
  duracion_extra_min?: number;
  persona_n?: number | null;
};

type AjustePayload = {
  tipo: string;
  monto: number;
  motivo: string;
};

type CoberturaPayload = {
  tipo: string;
  referencia_id?: string | null;
  monto: number;
};

type PagoPayload = {
  metodo: string;
  monto: number;
  numero_operacion?: string | null;
};

type PropinaPayload = {
  monto: number;
  metodo: string;
  numero_operacion?: string | null;
  distribucion: Array<{ terapista_id: string; monto: number }>;
};

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

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return { ok: false, error: "El identificador del intento no es válido. Recarga el flujo." };
  }
  if (!movimientoId || !reservaId || !Number.isInteger(personas) || personas < 1 || personas > 5) {
    return { ok: false, error: "La reserva no tiene datos suficientes para iniciar la atención." };
  }

  const extras = parseJson<ExtraPayload[]>(formData, "extras_json", []);
  const ajustes = parseJson<AjustePayload[]>(formData, "ajustes_json", []);
  const coberturas = parseJson<CoberturaPayload[]>(formData, "coberturas_json", []);
  const pagos = parseJson<PagoPayload[]>(formData, "pagos_json", []);
  const propina = parseJson<PropinaPayload | null>(formData, "propina_json", null);
  if (!extras || !ajustes || !coberturas || !pagos) {
    return { ok: false, error: "No se pudo interpretar el detalle económico de la atención. Recarga el flujo." };
  }
  if (!Array.isArray(extras) || !Array.isArray(ajustes) || !Array.isArray(coberturas) || !Array.isArray(pagos)) {
    return { ok: false, error: "El detalle económico de la atención no tiene el formato esperado." };
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
    total_cobrar: number;
    total_pagado: number;
    coberturas_totales: number;
    propina_registrada: number;
  }>("conciliar_atencion_v2", {
    p_payload: {
      request_id: requestId,
      movimiento_id: movimientoId,
      reserva_id: reservaId,
      terapistas,
      extras,
      ajustes,
      coberturas,
      pagos,
      propina,
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
    totalCobrar: Number(rpc.data.total_cobrar ?? 0),
    totalPagado: Number(rpc.data.total_pagado ?? 0),
    coberturasTotales: Number(rpc.data.coberturas_totales ?? 0),
    propinaRegistrada: Number(rpc.data.propina_registrada ?? 0),
    mensaje: rpc.data.completada
      ? "Atención completada y conciliada correctamente."
      : "Atención actualizada. Queda saldo pendiente y no se marcó como completada.",
  };
}
