import { NextRequest, NextResponse } from "next/server";
import { construirIcs } from "@/lib/fichaCitaPublica";
import {
  cargarCitaPorToken,
  cargarCliente,
  cargarSede,
  checkRateLimit,
  errorResponse,
  getClientIp,
  limpiarIntentos,
  registrarIntentoFallido,
  validarEstadoCita,
  type CitaRow,
} from "../../_lib";

/**
 * GET /api/publico/ficha/:token/ics
 *
 * Nuevo (no estaba en el contrato original de la sección 6): lo abre
 * directo el navegador del cliente desde el botón "agregar a mi
 * calendario" que devuelve `icsUrl` en el POST — por eso, a
 * diferencia de /api/publico/ficha/:token, NO lleva X-Caja-Secret.
 * Sigue protegido por el mismo límite de intentos por IP (sección 7)
 * y por el mismo token largo y aleatorio.
 *
 * No exige `estado_ficha = completa`: la cita ya está armada (fecha,
 * hora, servicio, sede) desde antes de que el cliente complete la
 * ficha, así que el evento puede agregarse al calendario en
 * cualquier momento de ese rango.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return errorResponse("token_no_existe", "El enlace no es válido.");
  }
  const ip = getClientIp(request);

  const { bloqueado, intentosPrevios } = await checkRateLimit(ip, token);
  if (bloqueado) {
    return errorResponse(
      "rate_limited",
      "Demasiados intentos. Intenta de nuevo más tarde."
    );
  }

  let cita: CitaRow | null;
  try {
    cita = await cargarCitaPorToken(token);
  } catch {
    return errorResponse("token_no_existe", "No se pudo verificar el token.");
  }

  if (!cita) {
    await registrarIntentoFallido(ip, token, intentosPrevios);
    return errorResponse("token_no_existe", "El enlace no es válido.");
  }

  await limpiarIntentos(ip, token);

  const estadoError = validarEstadoCita({ ...cita, estado_ficha: "pendiente" });
  if (estadoError) return estadoError;

  if (!cita.fecha_cita || !cita.hora_cita) {
    return errorResponse("validacion", "La cita todavía no tiene fecha u hora.");
  }

  const [cliente, sedeInfo] = await Promise.all([
    cargarCliente(cita.cliente_id),
    cargarSede(cita.sede),
  ]);

  const partes = [cliente?.cliente, cita.servicio, cita.sede].filter(
    (parte): parte is string => Boolean(parte && parte.trim())
  );
  const resumen = partes.length ? partes.join(" — ") : "Cita en Vita Lima";

  const ics = construirIcs({
    uid: `${cita.reserva_id}@caja-vita-lima`,
    fecha: cita.fecha_cita,
    hora: cita.hora_cita,
    duracionMin: cita.duracion_min ?? 60,
    resumen,
    ubicacion: sedeInfo?.direccion ?? cita.sede,
    descripcion: cita.servicio,
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cita-vita-lima.ics"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
