import { NextRequest } from "next/server";
import { supabaseRpc, supabaseSelectWhere } from "@/lib/supabaseServer";
import {
  enmascararEmail,
  mensajeWhatsappCita,
  normalizarTelefonoE164,
  plataformaDesdeCanal,
  politicaCancelacionUrl,
  requiereConsentimientoSalud,
  whatsappUrlNegocio,
} from "@/lib/fichaCitaPublica";
import {
  cargarCitaPorToken,
  cargarCliente,
  cargarSede,
  checkRateLimit,
  construirCitaResumen,
  autenticarApiPublica,
  errorResponse,
  getClientIp,
  limpiarIntentos,
  registrarIntentoFallido,
  jsonNoStore,
  validarEstadoCita,
  type CitaRow,
} from "../_lib";

/**
 * GET/POST /api/publico/ficha/:token
 *
 * Contrato cerrado en docs/caja-cambios-para-la-ficha-de-cita.md
 * (sección 6). Ya implementado del lado de la web en el PR #38 de
 * vita-lima-web (rama feat/ficha-cita). No cambiar formas de
 * request/response acá sin acordarlo primero en los dos repos.
 *
 * Requiere sql/013_ficha_cita_publica.sql corrido en Supabase.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const authError = autenticarApiPublica(request);
  if (authError) return authError;

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

  const estadoError = validarEstadoCita(cita);
  if (estadoError) return estadoError;

  const canal = (cita.canal ?? "directo") as string;
  const esDomicilio = cita.tipo_atencion === "domicilio";
  const esCuponidad = canal === "cuponidad";
  const esConvenio = esCuponidad || canal === "bee";

  const cliente = await cargarCliente(cita.cliente_id);

  const montoTotal = Number(cita.monto_total ?? 0);
  const adelanto = Number(cita.adelanto ?? 0);
  const saldo =
    cita.saldo_pendiente != null
      ? Number(cita.saldo_pendiente)
      : Math.max(montoTotal - adelanto, 0);

  const pago = esConvenio && !esDomicilio
    ? {
        moneda: "PEN",
        adelantoRecibido: 0,
        saldo,
        leyenda: esCuponidad ? "Pagado en Cuponidad" : "Pagado por Bee Beneficios",
      }
    : {
        moneda: "PEN",
        adelantoRecibido: adelanto,
        saldo,
        leyenda: "Adelanto recibido",
      };

  const sedeInfo = await cargarSede(cita.sede);

  const body: Record<string, unknown> = {
    token,
    estado: cita.estado_ficha ?? "pendiente",
    idioma: cita.idioma ?? "es",
    canal,
    cita: construirCitaResumen(cita, sedeInfo),
    pago,
    requiere: {
      codigoCupon: esConvenio,
      correoObligatorio: false,
      documentoParaBoleta: esConvenio ? "no" : "opcional",
    },
    cliente: {
      conocido: Boolean(cliente?.cliente),
      nombre: cliente?.cliente ?? null,
      emailEnmascarado: enmascararEmail(cliente?.email),
    },
    politicaCancelacionUrl: politicaCancelacionUrl(),
  };

  // cupon.vigenteHasta sale de citas_reservadas.cupon_vigente_hasta
  // (decisión del dueño): es una propiedad de la promoción elegida al
  // armar la cita, no de la fila de cupones_convenios, que en este
  // punto todavía no existe (el cliente aún no escribió el código).
  if (esConvenio) {
    body.cupon = { vigenteHasta: cita.cupon_vigente_hasta ?? null };
  }

  return jsonNoStore(body);
}

type FichaPostBody = {
  telefono?: { crudo?: string; pais?: string };
  nombre?: string;
  correo?: string;
  cumple?: { dia?: number; mes?: number } | null;
  boleta?: {
    requiere?: boolean;
    tipo?: "DNI" | "RUC";
    numero?: string;
    razonSocial?: string | null;
  };
  salud?: {
    embarazo?: boolean;
    presion?: boolean;
    cirugiaReciente?: boolean;
    alergias?: string;
    zonasEvitar?: string;
    notas?: string;
  };
  consentimientos?: { datos?: boolean; salud?: boolean; promociones?: boolean };
  codigoCupon?: string | null;
  idioma?: "es" | "en";
};

function idFicha() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `FSA-${stamp}-${rand}`;
}

function idCupon() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CUP-${stamp}-${rand}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const authError = autenticarApiPublica(request);
  if (authError) return authError;

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

  const estadoError = validarEstadoCita(cita);
  if (estadoError) return estadoError;

  let payload: FichaPostBody;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("validacion", "El cuerpo no es JSON válido.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse("validacion", "El cuerpo debe ser un objeto JSON.");
  }

  // --- Validación de servidor (sección 6: "toda la validación se
  // repite en el servidor; lo que valida la web es comodidad para el
  // cliente, lo que decide es caja") ---

  const nombre = (payload.nombre ?? "").trim();
  if (!nombre || nombre.length > 160) {
    return errorResponse("validacion", "Falta el nombre.");
  }

  const correo = (payload.correo ?? "").trim();
  if (correo && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 254)) {
    return errorResponse("validacion", "El correo no tiene un formato válido.");
  }

  const telefonoCrudo = (payload.telefono?.crudo ?? "").trim();
  const telefonoPais = (payload.telefono?.pais ?? "").trim();
  if (!telefonoCrudo || !telefonoPais) {
    return errorResponse("validacion", "Falta teléfono o país.");
  }

  const telefonoNormalizado = normalizarTelefonoE164(telefonoCrudo, telefonoPais);
  if (!telefonoNormalizado.ok) {
    return errorResponse(
      "validacion",
      "No se pudo interpretar el teléfono para ese país."
    );
  }

  const salud = payload.salud ?? {};
  const consentimientos = payload.consentimientos ?? {};

  // Regla del dueño: `datos` siempre obligatorio. `salud` solo si el
  // cliente marcó alguna condición — si no hay dato sensible, no hay
  // nada que consentir (condicionar el servicio a un consentimiento
  // que puede no aplicar lo vuelve no libre). `promociones` nunca
  // obligatorio (no se valida acá).
  if (!consentimientos.datos) {
    return errorResponse("validacion", "Falta aceptar el consentimiento de datos.");
  }
  if (requiereConsentimientoSalud(salud) && !consentimientos.salud) {
    return errorResponse(
      "validacion",
      "Falta aceptar el consentimiento de la ficha de salud."
    );
  }

  const boleta = payload.boleta ?? { requiere: false };
  if (boleta.requiere) {
    if (boleta.tipo !== "DNI" && boleta.tipo !== "RUC") {
      return errorResponse("validacion", "Tipo de documento inválido para boleta.");
    }
    if (!boleta.numero || !boleta.numero.trim()) {
      return errorResponse("validacion", "Falta el número de documento para boleta.");
    }
    const documento = boleta.numero.trim();
    if (boleta.tipo === "DNI" && !/^\d{8}$/.test(documento)) {
      return errorResponse("validacion", "El DNI debe tener 8 dígitos.");
    }
    if (boleta.tipo === "RUC" && !/^\d{11}$/.test(documento)) {
      return errorResponse("validacion", "El RUC debe tener 11 dígitos.");
    }
  }

  if (payload.idioma && payload.idioma !== "es" && payload.idioma !== "en") {
    return errorResponse("validacion", "El idioma es inválido.");
  }
  if (payload.cumple) {
    const { dia, mes } = payload.cumple;
    if (!Number.isInteger(dia) || !Number.isInteger(mes) || !dia || !mes || dia < 1 || dia > 31 || mes < 1 || mes > 12) {
      return errorResponse("validacion", "La fecha de cumpleaños es inválida.");
    }
  }

  const canal = cita.canal ?? "directo";
  const esCuponidad = canal === "cuponidad";
  const esConvenio = esCuponidad || canal === "bee";
  const codigoCupon = (payload.codigoCupon ?? "").trim();

  if (esConvenio && !codigoCupon) {
    return errorResponse("validacion", "Falta el código de cupón.");
  }

  if (codigoCupon) {
    const plataforma = plataformaDesdeCanal(canal);
    const existente = await supabaseSelectWhere(
      "cupones_convenios",
      [
        "select=registro_id",
        `plataforma=eq.${encodeURIComponent(plataforma)}`,
        `codigo_cupon=eq.${encodeURIComponent(codigoCupon)}`,
        "limit=1",
      ].join("&")
    );

    if (existente.error) {
      return errorResponse("validacion", "No se pudo verificar el cupón.");
    }

    if ((existente.data?.length ?? 0) > 0) {
      return errorResponse(
        "cupon_ya_usado",
        "Ese código de cupón ya fue usado. Si es un error, contáctanos por WhatsApp."
      );
    }
  }

  // --- Persistencia atómica (sql/014) ---
  const cumple = payload.cumple ?? null;
  const completar = await supabaseRpc<{ ok: boolean }>("completar_ficha_cita", {
    p_token: token,
    p_payload: {
      cliente_id:
        cita.cliente_id ?? `CLI-FICHA-${Date.now().toString(36).toUpperCase()}`,
      nombre,
      correo: correo || null,
      dni: boleta.requiere && boleta.tipo === "DNI" ? boleta.numero : null,
      whatsapp_e164: telefonoNormalizado.e164,
      pais_telefono: telefonoNormalizado.pais,
      idioma: payload.idioma ?? "es",
      cumple_dia: cumple?.dia ?? null,
      cumple_mes: cumple?.mes ?? null,
      consent_promos: Boolean(consentimientos.promociones),
      guardar_salud: requiereConsentimientoSalud(salud),
      salud: {
        embarazo: Boolean(salud.embarazo),
        presion: Boolean(salud.presion),
        cirugia_reciente: Boolean(salud.cirugiaReciente),
        alergias: salud.alergias || null,
        zonas_evitar: salud.zonasEvitar || null,
        notas: salud.notas || null,
      },
      ficha_id: idFicha(),
      codigo_cupon: codigoCupon || null,
      cupon_id: idCupon(),
    },
  });

  if (completar.error || !completar.data?.ok) {
    if (completar.error?.includes("CUPON_YA_USADO")) {
      return errorResponse(
        "cupon_ya_usado",
        "Ese código de cupón ya fue usado. Si es un error, contáctanos por WhatsApp."
      );
    }
    return errorResponse(
      "validacion",
      "No se pudo guardar la ficha de forma completa. No se aplicó ningún cambio parcial."
    );
  }

  const baseUrl = new URL(request.url).origin;
  const icsUrl = `${baseUrl}/api/publico/ficha/${token}/ics`;
  const whatsappUrl =
    cita.fecha_cita && cita.hora_cita
      ? whatsappUrlNegocio(
          mensajeWhatsappCita({
            fecha: cita.fecha_cita,
          hora: cita.hora_cita,
          sede: cita.sede,
          tipoAtencion: cita.tipo_atencion,
          distritoDomicilio: cita.domicilio_distrito,
          direccionDomicilio: cita.domicilio_direccion,
          referenciaDomicilio: cita.domicilio_referencia,
        })
        )
      : whatsappUrlNegocio("Hola, tengo una consulta sobre mi cita.");

  const sedeInfo = await cargarSede(cita.sede);

  return jsonNoStore({
    ok: true,
    icsUrl,
    whatsappUrl,
    resumen: {
      ...construirCitaResumen(cita, sedeInfo),
      moneda: "PEN",
      adelantoRecibido: esConvenio ? 0 : Number(cita.adelanto ?? 0),
      saldo:
        cita.saldo_pendiente != null
          ? Number(cita.saldo_pendiente)
          : Math.max(Number(cita.monto_total ?? 0) - Number(cita.adelanto ?? 0), 0),
    },
  });
}
