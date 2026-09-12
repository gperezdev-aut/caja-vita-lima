import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * Devuelve un enlace de WhatsApp solo para números válidos. Los valores E.164
 * conservan su país; los números nacionales legacy se interpretan como Perú.
 */
export function whatsappHref(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  const international = parsePhoneNumberFromString(
    raw.startsWith("+") ? raw : `+${digits}`
  );
  const phone = international?.isValid()
    ? international
    : parsePhoneNumberFromString(raw, "PE");

  if (!phone?.isValid()) return "";
  return `https://wa.me/${phone.number.slice(1)}`;
}

