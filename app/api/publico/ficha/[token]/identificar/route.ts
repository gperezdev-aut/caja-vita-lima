import { NextRequest } from "next/server";
import {
  claveIntentosIdentificacion,
  construirFichaRecurrente,
  telefonoCoincideConClienteAsociado,
} from "@/lib/fichaCitaRecurrente";
import {
  autenticarApiPublica,
  cargarCitaPorToken,
  cargarClienteParaIdentificar,
  cargarTelefonoClienteAsociado,
  cargarUltimaSaludCliente,
  cargarUltimaCitaCompletada,
  cargarUltimoComprobante,
  checkRateLimit,
  errorResponse,
  getClientIp,
  jsonNoStore,
  limpiarIntentos,
  registrarIntentoFallido,
  validarEstadoCita,
} from "../../_lib";

type IdentificarBody = {
  telefono?: { crudo?: string; pais?: string };
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function errorIdentificacion() {
  return errorResponse(
    "identificacion_no_valida",
    "No se pudo verificar la identidad con los datos proporcionados."
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const authError = autenticarApiPublica(request);
  if (authError) return authError;

  const { token } = await params;
  if (!TOKEN_RE.test(token)) {
    return errorResponse("token_no_existe", "El enlace no es válido.");
  }

  const ip = getClientIp(request);
  const claveIntentos = claveIntentosIdentificacion(token);
  const { bloqueado, intentosPrevios } = await checkRateLimit(ip, claveIntentos);
  if (bloqueado) {
    return errorResponse(
      "rate_limited",
      "Demasiados intentos. Intenta de nuevo más tarde."
    );
  }

  let cita;
  try {
    cita = await cargarCitaPorToken(token);
  } catch {
    return errorResponse("token_no_existe", "No se pudo verificar el token.");
  }
  if (!cita) {
    await registrarIntentoFallido(ip, claveIntentos, intentosPrevios);
    return errorResponse("token_no_existe", "El enlace no es válido.");
  }

  const estadoError = validarEstadoCita(cita);
  if (estadoError) return estadoError;

  let payload: IdentificarBody;
  try {
    payload = await request.json();
  } catch {
    await registrarIntentoFallido(ip, claveIntentos, intentosPrevios);
    return errorIdentificacion();
  }

  const telefono = {
    crudo: typeof payload?.telefono?.crudo === "string" ? payload.telefono.crudo : "",
    pais: typeof payload?.telefono?.pais === "string" ? payload.telefono.pais : "",
  };

  try {
    // Antes de coincidir solo se lee el identificador y el E.164 asociado a
    // esta cita. Correo, cumpleaños, salud y documentos se consultan después.
    const identidadAsociada = await cargarTelefonoClienteAsociado(cita.cliente_id);
    if (!identidadAsociada || !telefonoCoincideConClienteAsociado(telefono, identidadAsociada)) {
      await registrarIntentoFallido(ip, claveIntentos, intentosPrevios);
      return errorIdentificacion();
    }

    const cliente = await cargarClienteParaIdentificar(identidadAsociada.cliente_id);
    if (!cliente) {
      return errorResponse(
        "error_interno",
        "No se pudo recuperar la ficha anterior en este momento."
      );
    }

    const ultimaCitaCompletada = await cargarUltimaCitaCompletada(
      cliente.cliente_id,
      cita.reserva_id
    );
    const [ultimaFichaSalud, ultimoComprobante] = await Promise.all([
      cargarUltimaSaludCliente(cliente.cliente_id, cita.reserva_id),
      cargarUltimoComprobante(cliente.cliente_id, cita.reserva_id),
    ]);

    await limpiarIntentos(ip, claveIntentos);
    return jsonNoStore(
      construirFichaRecurrente({
        cliente,
        ultimaCitaCompletada,
        ultimaFichaSalud,
        ultimoComprobante,
      })
    );
  } catch {
    return errorResponse(
      "error_interno",
      "No se pudo recuperar la ficha anterior en este momento."
    );
  }
}
