import "server-only";

import { randomBytes } from "crypto";
import { getServerEnv } from "@/lib/env";
import { secretoCajaValido } from "@/lib/fichaCitaSeguridad";

/**
 * Helpers compartidos por GET/POST /api/publico/ficha/[token].
 * Contrato cerrado en docs/caja-cambios-para-la-ficha-de-cita.md
 * (sección 6), ya implementado del lado de la web en el PR #38 de
 * vita-lima-web. No cambiar las formas de request/response desde
 * acá sin actualizar ese contrato en los dos repos a la vez.
 */

export { CANALES_FICHA as FICHA_CANALES } from "@/lib/fichaCitaDominio";
export type { CanalFicha as FichaCanal } from "@/lib/fichaCitaDominio";
export { normalizarTelefonoE164 } from "@/lib/fichaCitaDominio";
export type { NormalizarTelefonoResultado } from "@/lib/fichaCitaDominio";

export type FichaErrorCode =
  | "configuracion"
  | "no_autorizado"
  | "token_no_existe"
  | "token_vencido"
  | "ficha_ya_completa"
  | "telefono_asociado_otro_cliente"
  | "cupon_ya_usado"
  | "validacion"
  | "rate_limited";

const ERROR_HTTP_STATUS: Record<FichaErrorCode, number> = {
  configuracion: 500,
  no_autorizado: 401,
  token_no_existe: 404,
  token_vencido: 410,
  ficha_ya_completa: 410,
  telefono_asociado_otro_cliente: 409,
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
  const recibido = headers.get("x-caja-secret") ?? "";
  return secretoCajaValido(recibido, secretoEsperado);
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
  tipoAtencion?: string | null;
  distritoDomicilio?: string | null;
  direccionDomicilio?: string | null;
  referenciaDomicilio?: string | null;
}) {
  const diaNumero = Number(cita.fecha.split("-")[2]);
  const diaSemana = nombreDiaSemana(cita.fecha);
  const horaFmt = formatHora12h(cita.hora);
  const domicilio = [
    cita.distritoDomicilio,
    cita.direccionDomicilio,
    cita.referenciaDomicilio ? `Referencia: ${cita.referenciaDomicilio}` : null,
  ].filter((item): item is string => Boolean(item?.trim())).join(" · ");
  const sedeTxt = cita.tipoAtencion === "domicilio"
    ? ` para Atención a domicilio${domicilio ? ` (${domicilio})` : ""}`
    : cita.sede ? ` en ${cita.sede}` : "";

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

/**
 * `plataforma` para cupones_convenios: el POST de la sección 6 solo
 * manda `codigoCupon`, no una plataforma explícita. Se infiere del
 * `canal` de la cita. Tanto Cuponidad como Bee requieren código cuando una
 * cita histórica de convenio completa su ficha; los valores de plataforma
 * se conservan separados para la restricción única.
 */
export function plataformaDesdeCanal(canal: string) {
  if (canal === "cuponidad") return "Cuponidad";
  if (canal === "bee") return "Bee Beneficios";
  return canal;
}
