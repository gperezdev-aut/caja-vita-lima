import "server-only";

import { randomBytes, timingSafeEqual } from "crypto";
import { getServerEnv } from "@/lib/env";

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
 * Direcciones, horarios y enlace de Maps por sede viven ahora en
 * `public.sedes` (sql/013_ficha_cita_publica.sql) — se consultan con
 * supabaseSelectWhere desde la ruta, no acá (este archivo no debe
 * depender de supabaseServer). Ver GET en
 * app/api/publico/ficha/[token]/route.ts.
 *
 * `politicaCancelacionUrl` sí es una constante — la misma URL para
 * las dos sedes, así que es variable de entorno, no un dato de
 * Supabase.
 */
export function politicaCancelacionUrl() {
  return getServerEnv("CAJA_POLITICA_CANCELACION_URL") || null;
}

/**
 * Sección 6 del documento (revisión del dueño): `datos` siempre
 * obligatorio; `promociones` nunca obligatorio; `salud` obligatorio
 * SOLO si el cliente marcó alguna condición en el bloque `salud` —
 * si no hay dato sensible, no hay nada que consentir. El cambio de
 * UI correspondiente (mostrar la casilla de salud solo si aplica)
 * queda del lado de la web (PR #38), no acá — esto solo decide si
 * el servidor exige el booleano en `true`.
 */
export function requiereConsentimientoSalud(salud: {
  embarazo?: boolean;
  presion?: boolean;
  cirugiaReciente?: boolean;
  alergias?: string;
  zonasEvitar?: string;
  notas?: string;
} | undefined | null) {
  if (!salud) return false;

  return Boolean(
    salud.embarazo ||
      salud.presion ||
      salud.cirugiaReciente ||
      salud.alergias?.trim() ||
      salud.zonasEvitar?.trim() ||
      salud.notas?.trim()
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const DIAS_SEMANA_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

function nombreDiaSemana(fechaISO: string) {
  const [y, mo, d] = fechaISO.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, mo - 1, d));
  return DIAS_SEMANA_ES[utcDate.getUTCDay()];
}

function formatHora12h(hora: string) {
  const [hStr, mStr] = hora.split(":");
  let h = Number(hStr ?? 0);
  const m = mStr ?? "00";
  const sufijo = h >= 12 ? "p.m." : "a.m.";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${sufijo}`;
}

/**
 * "Hola, tengo una consulta sobre mi cita del sábado 13 a las 4:00
 * p.m. en San Borja." — para que el cliente pueda pedir un cambio
 * sin tener que explicar cuál es su reserva (decisión del dueño).
 */
export function mensajeWhatsappCita(cita: {
  fecha: string;
  hora: string;
  sede: string | null;
}) {
  const diaNumero = Number(cita.fecha.split("-")[2]);
  const diaSemana = nombreDiaSemana(cita.fecha);
  const horaFmt = formatHora12h(cita.hora);
  const sedeTxt = cita.sede ? ` en ${cita.sede}` : "";

  return `Hola, tengo una consulta sobre mi cita del ${diaSemana} ${diaNumero} a las ${horaFmt}${sedeTxt}.`;
}

/**
 * `wa.me` al número del negocio (no al del cliente) — decisión del
 * dueño. `CAJA_WHATSAPP_NEGOCIO` sin formato especial, se limpia acá.
 */
export function whatsappUrlNegocio(mensaje: string) {
  const numero = getServerEnv("CAJA_WHATSAPP_NEGOCIO").replace(/\D/g, "");
  const base = numero ? `https://wa.me/${numero}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(mensaje)}`;
}

function walltimeToIcs(y: number, mo: number, d: number, h: number, mi: number, s: number) {
  return `${y}${pad2(mo)}${pad2(d)}T${pad2(h)}${pad2(mi)}${pad2(s)}`;
}

function escapeIcsText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * .ics con TZID=America/Lima explícito y un VTIMEZONE embebido de
 * offset fijo -05:00 (Perú no tiene horario de verano) — decisión
 * del dueño, para no depender de que el calendario del cliente
 * conozca esa zona (GET /api/publico/ficha/[token]/ics).
 *
 * DTSTART/DTEND se arman como aritmética de reloj de pared (misma
 * zona en los dos lados), no como conversión real de zona horaria:
 * no hace falta más que eso porque el offset de Lima nunca cambia.
 */
export function construirIcs(opts: {
  uid: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM o HH:MM:SS
  duracionMin: number;
  resumen: string;
  ubicacion?: string | null;
  descripcion?: string | null;
}) {
  const [y, mo, d] = opts.fecha.split("-").map(Number);
  const [hStr, mStr, sStr] = opts.hora.split(":");
  const h = Number(hStr ?? 0);
  const mi = Number(mStr ?? 0);
  const s = Number(sStr ?? 0);

  const startUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const endDate = new Date(startUtcMs + Math.max(opts.duracionMin, 0) * 60000);

  const dtstart = walltimeToIcs(y, mo, d, h, mi, s);
  const dtend = walltimeToIcs(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth() + 1,
    endDate.getUTCDate(),
    endDate.getUTCHours(),
    endDate.getUTCMinutes(),
    endDate.getUTCSeconds()
  );

  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(
    now.getUTCDate()
  )}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vita Lima//Ficha de Cita//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:America/Lima",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0500",
    "TZNAME:-05",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=America/Lima:${dtstart}`,
    `DTEND;TZID=America/Lima:${dtend}`,
    `SUMMARY:${escapeIcsText(opts.resumen)}`,
    opts.ubicacion ? `LOCATION:${escapeIcsText(opts.ubicacion)}` : null,
    opts.descripcion ? `DESCRIPTION:${escapeIcsText(opts.descripcion)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));

  return lines.join("\r\n");
}

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
