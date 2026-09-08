import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { supabaseSelectWhere, supabaseUpsert } from "@/lib/supabaseServer";
import { fichaErrorBody, fichaErrorStatus, type FichaErrorCode } from "@/lib/fichaCitaPublica";

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
  idioma: string | null;
  cupon_vigente_hasta: string | null;
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
export function verificarSecreto(request: NextRequest) {
  const esperado = getServerEnv("CAJA_API_SECRET");
  const recibido = request.headers.get("x-caja-secret") ?? "";
  return Boolean(esperado) && recibido === esperado;
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
      "select=reserva_id,cliente_id,fecha_cita,hora_cita,sede,n_pax,personas,servicio,duracion_min,monto_total,adelanto,saldo_pendiente,estado_ficha,token_expira,canal,idioma,cupon_vigente_hasta",
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
  return {
    fecha: cita.fecha_cita,
    hora: cita.hora_cita ? String(cita.hora_cita).slice(0, 5) : cita.hora_cita,
    sede: cita.sede,
    sedeDireccion: sedeInfo?.direccion ?? null,
    sedeMapsUrl: sedeInfo?.maps_url ?? null,
    personas: cita.personas ?? cita.n_pax ?? 1,
    servicios: cita.servicio
      ? [{ nombre: cita.servicio, duracionMin: cita.duracion_min ?? null }]
      : [],
    duracionTotalMin: cita.duracion_min ?? null,
  };
}
