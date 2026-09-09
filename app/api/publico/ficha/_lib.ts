import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { supabaseSelectWhere, supabaseUpsert } from "@/lib/supabaseServer";
import type {
  CitaAnteriorRow,
  ComprobanteAnteriorRow,
  FichaSaludAnteriorRow,
  ClienteIdentificacionRow,
} from "@/lib/fichaCitaRecurrente";
import {
  fichaErrorBody,
  fichaErrorStatus,
  verificarSecretoCaja,
  type FichaErrorCode,
} from "@/lib/fichaCitaPublica";
import { describirAtencionDomicilio, evaluarEstadoToken } from "@/lib/fichaCitaDominio";

/**
 * Piezas compartidas entre GET/POST /api/publico/ficha/[token] y
 * GET /api/publico/ficha/[token]/ics. Este archivo NO se llama
 * route.ts a propósito: Next.js App Router solo trata route.ts (o
 * page.tsx) como endpoint, así que esto es un módulo normal, sin
 * ruta propia.
 */

export const MAX_INTENTOS = 20;
export const BLOQUEO_MINUTOS = 15;

export type CitaRow = {
  reserva_id: string;
  cliente_id: string | null;
  fecha_cita: string | null;
  hora_cita: string | null;
  sede: string | null;
  n_pax: number | null;
  personas: number | null;
  servicio: string | null;
  duracion_min: number | null;
  monto_total: number | null;
  adelanto: number | null;
  saldo_pendiente: number | null;
  estado_ficha: string | null;
  token_expira: string | null;
  canal: string | null;
  requiere_confirmacion: boolean | null;
  confirmado_en: string | null;
  idioma: string | null;
  cupon_vigente_hasta: string | null;
  tipo_atencion: string | null;
  sede_operativa: string | null;
  domicilio_distrito: string | null;
  domicilio_direccion: string | null;
  domicilio_referencia: string | null;
  costo_movilidad: number | null;
  servicios_json: Array<{
    nombre?: string;
    duracion_min?: number;
  }> | null;
};

export type ClienteRow = {
  cliente_id: string;
  cliente: string | null;
  email: string | null;
  whatsapp: string | null;
};

export type SedeRow = {
  direccion: string | null;
  maps_url: string | null;
};

type IntentoRow = {
  ip: string;
  token: string;
  intentos: number | null;
  bloqueado_hasta: string | null;
};

export function errorResponse(code: FichaErrorCode, mensaje: string) {
  return NextResponse.json(fichaErrorBody(code, mensaje), {
    status: fichaErrorStatus(code),
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Solo la usa GET/POST /api/publico/ficha/[token] (servidor-a-servidor,
 * sección 6). GET .../ics NO la usa: la abre directo el navegador del
 * cliente, que no tiene el secreto.
 */
export function autenticarApiPublica(request: NextRequest) {
  const esperado = getServerEnv("CAJA_API_SECRET");
  if (!esperado) {
    return errorResponse(
      "configuracion",
      "Falta la configuración del servidor para la API pública."
    );
  }

  if (!verificarSecretoCaja(request.headers, esperado)) {
    return errorResponse("no_autorizado", "Falta o no coincide X-Caja-Secret.");
  }

  return null;
}

export function validarEstadoCita(cita: CitaRow) {
  const estado = evaluarEstadoToken(cita);
  if (estado === "token_vencido") {
    return errorResponse("token_vencido", "El enlace ya venció.");
  }
  if (estado === "ficha_ya_completa") {
    return errorResponse("ficha_ya_completa", "Esta ficha ya fue completada.");
  }
  return null;
}

export async function checkRateLimit(ip: string, token: string) {
  const previos = await supabaseSelectWhere<IntentoRow>(
    "ficha_publica_intentos",
    [
      "select=ip,token,intentos,bloqueado_hasta",
      `ip=eq.${encodeURIComponent(ip)}`,
      `token=eq.${encodeURIComponent(token)}`,
      "limit=1",
    ].join("&")
  );

  const previo = previos.data?.[0];
  const bloqueadoHasta = previo?.bloqueado_hasta
    ? new Date(previo.bloqueado_hasta)
    : null;

  return {
    bloqueado: Boolean(bloqueadoHasta && bloqueadoHasta.getTime() > Date.now()),
    intentosPrevios: previo?.intentos ?? 0,
  };
}

export async function registrarIntentoFallido(
  ip: string,
  token: string,
  intentosPrevios: number
) {
  const intentos = intentosPrevios + 1;
  const bloqueado_hasta =
    intentos >= MAX_INTENTOS
      ? new Date(Date.now() + BLOQUEO_MINUTOS * 60 * 1000).toISOString()
      : null;

  await supabaseUpsert(
    "ficha_publica_intentos",
    { ip, token, intentos, bloqueado_hasta, ultimo_intento: new Date().toISOString() },
    "ip,token"
  );
}

export async function limpiarIntentos(ip: string, token: string) {
  await supabaseUpsert(
    "ficha_publica_intentos",
    {
      ip,
      token,
      intentos: 0,
      bloqueado_hasta: null,
      ultimo_intento: new Date().toISOString(),
    },
    "ip,token"
  );
}

export async function cargarCitaPorToken(token: string) {
  const result = await supabaseSelectWhere<CitaRow>(
    "citas_reservadas",
    [
      "select=reserva_id,cliente_id,fecha_cita,hora_cita,sede,n_pax,personas,servicio,duracion_min,monto_total,adelanto,saldo_pendiente,estado_ficha,token_expira,canal,requiere_confirmacion,confirmado_en,idioma,cupon_vigente_hasta,servicios_json,tipo_atencion,sede_operativa,domicilio_distrito,domicilio_direccion,domicilio_referencia,costo_movilidad",
      `token_ficha=eq.${encodeURIComponent(token)}`,
      "limit=1",
    ].join("&")
  );

  if (result.error) {
    throw new Error(result.error);
  }

  return result.data?.[0] ?? null;
}

export async function cargarCliente(clienteId: string | null) {
  if (!clienteId) return null;

  const result = await supabaseSelectWhere<ClienteRow>(
    "clientes",
    [
      "select=cliente_id,cliente,email,whatsapp",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      "limit=1",
    ].join("&")
  );

  return result.data?.[0] ?? null;
}

export async function cargarSede(nombre: string | null) {
  if (!nombre) return null;

  const result = await supabaseSelectWhere<SedeRow>(
    "sedes",
    [
      "select=direccion,maps_url",
      `nombre=eq.${encodeURIComponent(nombre)}`,
      "limit=1",
    ].join("&")
  );

  return result.data?.[0] ?? null;
}

export function construirCitaResumen(cita: CitaRow, sedeInfo: SedeRow | null) {
  const servicios = Array.isArray(cita.servicios_json) && cita.servicios_json.length
    ? cita.servicios_json
        .filter((item) => item?.nombre)
        .map((item) => ({
          nombre: String(item.nombre),
          duracionMin: Number(item.duracion_min) || null,
        }))
    : cita.servicio
      ? [{ nombre: cita.servicio, duracionMin: cita.duracion_min ?? null }]
      : [];

  const esDomicilio = cita.tipo_atencion === "domicilio";
  const direccionDomicilio = [
    cita.domicilio_distrito,
    cita.domicilio_direccion,
    cita.domicilio_referencia ? `Referencia: ${cita.domicilio_referencia}` : null,
  ].filter((item): item is string => Boolean(item?.trim())).join(" · ");
  const sedeVisible = esDomicilio
    ? describirAtencionDomicilio({
        distrito: cita.domicilio_distrito ?? "",
        direccion: cita.domicilio_direccion ?? "",
        referencia: cita.domicilio_referencia,
      })
    : cita.sede;

  return {
    fecha: cita.fecha_cita,
    hora: cita.hora_cita ? String(cita.hora_cita).slice(0, 5) : cita.hora_cita,
    sede: sedeVisible,
    sedeDireccion: esDomicilio ? direccionDomicilio || null : sedeInfo?.direccion ?? null,
    sedeMapsUrl: esDomicilio ? null : sedeInfo?.maps_url ?? null,
    personas: cita.personas ?? cita.n_pax ?? 1,
    servicios,
    duracionTotalMin: cita.duracion_min ?? null,
    tipoAtencion: esDomicilio ? "domicilio" : "sede",
    domicilio: esDomicilio
      ? {
          distrito: cita.domicilio_distrito,
          direccion: cita.domicilio_direccion,
          referencia: cita.domicilio_referencia,
        }
      : null,
  };
}

export async function cargarClienteParaIdentificar(clienteId: string | null) {
  if (!clienteId) return null;

  const result = await supabaseSelectWhere<ClienteIdentificacionRow>(
    "clientes",
    [
      "select=cliente_id,cliente,email,whatsapp_e164,cumple_dia,cumple_mes,consent_promos_en",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      "limit=1",
    ].join("&")
  );
  if (result.error) throw new Error("No se pudo cargar el cliente asociado.");
  return result.data?.[0] ?? null;
}

export async function cargarTelefonoClienteAsociado(clienteId: string | null) {
  if (!clienteId) return null;

  const result = await supabaseSelectWhere<
    Pick<ClienteIdentificacionRow, "cliente_id" | "whatsapp_e164">
  >(
    "clientes",
    [
      "select=cliente_id,whatsapp_e164",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      "limit=1",
    ].join("&")
  );
  if (result.error) throw new Error("No se pudo verificar el cliente asociado.");
  return result.data?.[0] ?? null;
}

export async function cargarUltimaCitaCompletada(
  clienteId: string,
  reservaActualId: string
) {
  const result = await supabaseSelectWhere<CitaAnteriorRow>(
    "citas_reservadas",
    [
      "select=reserva_id,updated_at",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      `reserva_id=neq.${encodeURIComponent(reservaActualId)}`,
      "estado_ficha=eq.completa",
      "order=updated_at.desc.nullslast",
      "limit=1",
    ].join("&")
  );
  if (result.error) throw new Error("No se pudo cargar la cita anterior.");
  return result.data?.[0] ?? null;
}

export async function cargarUltimaSaludCliente(
  clienteId: string,
  reservaActualId: string
) {
  const result = await supabaseSelectWhere<FichaSaludAnteriorRow>(
    "fichas_salud",
    [
      "select=reserva_id,cliente_id,embarazo,presion,cirugia_reciente,alergias,zonas_evitar,notas",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      `reserva_id=neq.${encodeURIComponent(reservaActualId)}`,
      "order=creado_en.desc",
      "limit=1",
    ].join("&")
  );
  if (result.error) throw new Error("No se pudo cargar la ficha anterior.");
  return result.data?.[0] ?? null;
}

export async function cargarUltimoComprobante(
  clienteId: string,
  reservaActualId: string
) {
  const result = await supabaseSelectWhere<ComprobanteAnteriorRow>(
    "solicitudes_comprobante",
    [
      "select=reserva_id,cliente_id,tipo_comprobante,tipo_documento,numero_documento,razon_social",
      `cliente_id=eq.${encodeURIComponent(clienteId)}`,
      `reserva_id=neq.${encodeURIComponent(reservaActualId)}`,
      "order=creado_en.desc",
      "limit=1",
    ].join("&")
  );
  if (result.error) throw new Error("No se pudo cargar el comprobante anterior.");
  return result.data?.[0] ?? null;
}
