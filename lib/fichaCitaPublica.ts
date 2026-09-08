import "server-only";

import { randomBytes, timingSafeEqual } from "crypto";

/**
 * Helpers compartidos por GET/POST /api/publico/ficha/[token].
 * Contrato cerrado en docs/caja-cambios-para-la-ficha-de-cita.md
 * (sección 6), ya implementado del lado de la web en el PR #38 de
 * vita-lima-web. No cambiar las formas de request/response desde
 * acá sin actualizar ese contrato en los dos repos a la vez.
 */

export const FICHA_CANALES = ["directo", "cuponidad", "bee"] as const;
export type FichaCanal = (typeof FICHA_CANALES)[number];

export type FichaErrorCode =
  | "no_autorizado"
  | "token_no_existe"
  | "token_vencido"
  | "ficha_ya_completa"
  | "cupon_ya_usado"
  | "validacion"
  | "rate_limited";

const ERROR_HTTP_STATUS: Record<FichaErrorCode, number> = {
  no_autorizado: 401,
  token_no_existe: 404,
  token_vencido: 410,
  ficha_ya_completa: 410,
  cupon_ya_usado: 409,
  validacion: 422,
  rate_limited: 429,
};

export function fichaErrorStatus(code: FichaErrorCode) {
  return ERROR_HTTP_STATUS[code];
}

export function fichaErrorBody(code: FichaErrorCode, mensaje: string) {
  return { error: code, mensaje };
}

/**
 * Token largo y aleatorio (sección 7 del documento): no el id()
 * de app/nueva-atencion/actions.ts (Math.random, pensado para ids
 * legibles, no para proteger datos de salud). 32 bytes = 256 bits,
 * codificado en base64url para que vaya limpio en una URL.
 */
export function generarTokenFicha() {
  return randomBytes(32).toString("base64url");
}

/**
 * Cabecera de autenticación servidor-a-servidor (sección 6).
 * request.headers.get() ya es case-insensitive en la Fetch API, pero
 * se compara igual contra el nombre en minúsculas porque así lo pide
 * el documento (ya costó tiempo una vez con el webhook de n8n) y para
 * dejar explícito que no importa cómo lo mande el cliente.
 */
export function verificarSecretoCaja(headers: Headers, secretoEsperado: string) {
  if (!secretoEsperado) return false;

  const recibido = headers.get("x-caja-secret") ?? "";
  const a = Buffer.from(recibido);
  const b = Buffer.from(secretoEsperado);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * r***@gmail.com — conserva la primera letra y el dominio completo.
 */
export function enmascararEmail(email: string | null | undefined) {
  if (!email) return null;

  const [usuario, dominio] = email.split("@");

  if (!usuario || !dominio) return null;

  const inicial = usuario.slice(0, 1);
  return `${inicial}${"*".repeat(Math.max(usuario.length - 1, 3))}@${dominio}`;
}

/**
 * Prefijos internacionales cubiertos para normalizar `telefono` a
 * E.164 en la POST. Es un mapa chico a propósito: la clientela real
 * es sobre todo Perú, con algo de turismo de estos países. Un país
 * fuera de esta lista responde 422 (validacion) en vez de adivinar
 * — no hay forma segura de inferir el largo de un número que no se
 * conoce.
 */
const PREFIJOS_PAIS: Record<string, string> = {
  PE: "51",
  US: "1",
  CA: "1",
  MX: "52",
  CO: "57",
  CL: "56",
  AR: "54",
  BR: "55",
  EC: "593",
  BO: "591",
  VE: "58",
  ES: "34",
  GB: "44",
  DE: "49",
  FR: "33",
  IT: "39",
};

export type NormalizarTelefonoResultado =
  | { ok: true; e164: string; pais: string }
  | { ok: false };

export function normalizarTelefonoE164(
  crudo: string,
  pais: string
): NormalizarTelefonoResultado {
  const soloDigitos = crudo.replace(/\D/g, "");

  if (crudo.trim().startsWith("+")) {
    if (soloDigitos.length >= 8 && soloDigitos.length <= 15) {
      return { ok: true, e164: `+${soloDigitos}`, pais: pais.toUpperCase() };
    }
    return { ok: false };
  }

  const paisNormalizado = pais.trim().toUpperCase();
  const prefijo = PREFIJOS_PAIS[paisNormalizado];

  if (!prefijo || soloDigitos.length < 6 || soloDigitos.length > 12) {
    return { ok: false };
  }

  return {
    ok: true,
    e164: `+${prefijo}${soloDigitos}`,
    pais: paisNormalizado,
  };
}

/**
 * Direcciones y enlaces de Maps por sede, y la política de
 * cancelación. No hay dónde guardar esto en el esquema actual
 * (config_listas solo tiene lista/valor/orden, sin campos para
 * dirección o URL) y el documento no pide crear una tabla para
 * esto, así que quedan como constantes acá.
 *
 * ⚠️ PENDIENTE: direcciones, enlaces de Maps y la URL de política de
 * cancelación son placeholders — hay que reemplazarlos por los reales
 * antes de que esto sirva tráfico real.
 */
export const SEDE_INFO: Record<string, { direccion: string; mapsUrl: string }> = {
  "San Borja": {
    direccion: "PENDIENTE: dirección real de la sede San Borja",
    mapsUrl: "https://maps.google.com/?q=Vita+Lima+San+Borja",
  },
  Miraflores: {
    direccion: "PENDIENTE: dirección real de la sede Miraflores",
    mapsUrl: "https://maps.google.com/?q=Vita+Lima+Miraflores",
  },
};

export const POLITICA_CANCELACION_URL_DEFAULT =
  "PENDIENTE: URL real de la política de cancelación";

/**
 * `plataforma` para cupones_convenios: el POST de la sección 6 solo
 * manda `codigoCupon`, no una plataforma explícita. Se infiere del
 * `canal` de la cita. Si en el futuro `canal = 'bee'` también debe
 * declarar cupón, hay que decidir su valor de plataforma aparte —
 * hoy solo 'cuponidad' pide codigoCupon (requiere.codigoCupon en el
 * GET solo se activa en ese canal).
 */
export function plataformaDesdeCanal(canal: string) {
  if (canal === "cuponidad") return "Cuponidad";
  return canal;
}
