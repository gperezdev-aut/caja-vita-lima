export type GiftCardType = "SERVICIO" | "MONTO";
export type GiftCardStatus =
  | "EMITIDA"
  | "PARCIALMENTE_USADA"
  | "USADA"
  | "VENCIDA"
  | "ANULADA";

export const GIFT_CARD_CODE_PATTERN = /^GC-VITA-[A-Z0-9]{8}$/;

export function addOneCalendarYear(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return "";
  const year = Number(match[1]) + 1;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function formatGiftCardDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

export function giftCardEffectiveStatus(
  status: GiftCardStatus,
  expiration: string,
  today: string,
): GiftCardStatus {
  if (status === "ANULADA" || status === "USADA") return status;
  return expiration < today ? "VENCIDA" : status;
}

export function validateGiftCardPayment(input: {
  value: number;
  received: number;
  method: string;
  operation: string;
}) {
  if (!Number.isFinite(input.value) || input.value <= 0) return "El valor debe ser mayor que cero.";
  if (input.received !== input.value) return "La Gift Card requiere pago total.";
  if (!input.method) return "Selecciona el método de pago.";
  if (input.method.toUpperCase() !== "EFECTIVO" && !input.operation.trim()) {
    return "Ingresa el número de operación.";
  }
  return "";
}

export function whatsappGiftCardUrl(phone: string, code: string, viewUrl: string) {
  const digits = phone.replace(/\D/g, "");
  const message = `Tu Gift Card Vita Lima ${code} está lista: ${viewUrl}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
