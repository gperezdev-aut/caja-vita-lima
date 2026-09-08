import { timingSafeEqual } from "crypto";

export function secretoCajaValido(recibido: string, esperado: string) {
  if (!esperado) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

