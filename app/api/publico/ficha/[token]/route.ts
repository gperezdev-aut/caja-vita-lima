import { NextRequest, NextResponse } from "next/server";
import { supabaseInsert, supabaseSelectWhere, supabaseUpsert } from "@/lib/supabaseServer";
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
  errorResponse,
  getClientIp,
  limpiarIntentos,
  registrarIntentoFallido,
  verificarSecreto,
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
  if (!verificarSecreto(request)) {
    return errorResponse("no_autorizado", "Falta o no coincide X-Caja-Secret.");
  }

  const { token } = await params;
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

  if (cita.token_expira && new Date(cita.token_expira).getTime() < Date.now()) {
    return errorResponse("token_vencido", "El enlace ya venció.");
  }

  if (cita.estado_ficha === "completa") {
    return errorResponse("ficha_ya_completa", "Esta ficha ya fue completada.");
  }

  const canal = (cita.canal ?? "directo") as string;
  const esCuponidad = canal === "cuponidad";

  const cliente = await cargarCliente(cita.cliente_id);

  const montoTotal = Number(cita.monto_total ?? 0);
  const adelanto = Number(cita.adelanto ?? 0);
  const saldo =
    cita.saldo_pendiente != null
      ? Number(cita.saldo_pendiente)
      : Math.max(montoTotal - adelanto, 0);

  const pago = esCuponidad
    ? {
        moneda: "PEN",
        adelantoRecibido: 0,
        saldo,
        leyenda: "Pagado en Cuponidad",
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
      codigoCupon: esCuponidad,
      correoObligatorio: false,
      documentoParaBoleta: esCuponidad ? "no" : "opcional",
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
  if (esCuponidad) {
    body.cupon = { vigenteHasta: cita.cupon_vigente_hasta ?? null };
  }

  return NextResponse.json(body);
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
  if (!verificarSecreto(request)) {
    return errorResponse("no_autorizado", "Falta o no coincide X-Caja-Secret.");
  }

  const { token } = await params;
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

  if (cita.token_expira && new Date(cita.token_expira).getTime() < Date.now()) {
    return errorResponse("token_vencido", "El enlace ya venció.");
  }

  if (cita.estado_ficha === "completa") {
    return errorResponse("ficha_ya_completa", "Esta ficha ya fue completada.");
  }

  let payload: FichaPostBody;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("validacion", "El cuerpo no es JSON válido.");
  }

  // --- Validación de servidor (sección 6: "toda la validación se
  // repite en el servidor; lo que valida la web es comodidad para el
  // cliente, lo que decide es caja") ---

  const nombre = (payload.nombre ?? "").trim();
  if (!nombre) {
    return errorResponse("validacion", "Falta el nombre.");
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
  }

  const canal = cita.canal ?? "directo";
  const esCuponidad = canal === "cuponidad";
  const codigoCupon = (payload.codigoCupon ?? "").trim();

  if (esCuponidad && !codigoCupon) {
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

  // --- Persistencia ---

  const ahora = new Date().toISOString();
  let clienteId = cita.cliente_id ?? "";

  if (!clienteId) {
    const existenteWa = await supabaseSelectWhere<{ cliente_id: string }>(
      "clientes",
      `select=cliente_id&whatsapp_e164=eq.${encodeURIComponent(
        telefonoNormalizado.e164
      )}&limit=1`
    );
    clienteId =
      existenteWa.data?.[0]?.cliente_id ??
      `CLI-FICHA-${Date.now().toString(36).toUpperCase()}`;
  }

  const cumple = payload.cumple ?? null;

  const clienteUpsert = await supabaseUpsert(
    "clientes",
    {
      cliente_id: clienteId,
      cliente: nombre,
      email: payload.correo || null,
      dni: boleta.requiere && boleta.tipo === "DNI" ? boleta.numero : undefined,
      whatsapp_e164: telefonoNormalizado.e164,
      pais_telefono: telefonoNormalizado.pais,
      idioma: payload.idioma ?? "es",
      cumple_dia: cumple?.dia ?? null,
      cumple_mes: cumple?.mes ?? null,
      consent_datos_en: ahora,
      consent_promos_en: consentimientos.promociones ? ahora : null,
      updated_at: ahora,
    },
    "cliente_id"
  );

  if (clienteUpsert.error) {
    return errorResponse("validacion", `No se pudo guardar el cliente: ${clienteUpsert.error}`);
  }

  const fichaSaludUpsert = await supabaseUpsert(
    "fichas_salud",
    {
      ficha_id: idFicha(),
      reserva_id: cita.reserva_id,
      cliente_id: clienteId,
      embarazo: Boolean(salud.embarazo),
      presion: Boolean(salud.presion),
      cirugia_reciente: Boolean(salud.cirugiaReciente),
      alergias: salud.alergias || null,
      zonas_evitar: salud.zonasEvitar || null,
      notas: salud.notas || null,
      consent_salud_en: ahora,
    },
    "reserva_id"
  );

  if (fichaSaludUpsert.error) {
    return errorResponse(
      "validacion",
      `No se pudo guardar la ficha de salud: ${fichaSaludUpsert.error}`
    );
  }

  if (codigoCupon) {
    const cuponInsert = await supabaseInsert("cupones_convenios", {
      registro_id: idCupon(),
      fecha: cita.fecha_cita,
      sede: cita.sede,
      plataforma: plataformaDesdeCanal(canal),
      codigo_cupon: codigoCupon,
      cliente: nombre,
      whatsapp: telefonoNormalizado.e164,
      n_pax: cita.personas ?? cita.n_pax ?? 1,
      servicio: cita.servicio,
      estado: "declarado",
      reserva_id: cita.reserva_id,
    });

    if (cuponInsert.error) {
      return errorResponse(
        "cupon_ya_usado",
        "Ese código de cupón ya fue usado. Si es un error, contáctanos por WhatsApp."
      );
    }
  }

  const citaUpdate = await supabaseUpsert(
    "citas_reservadas",
    {
      reserva_id: cita.reserva_id,
      cliente_id: clienteId,
      cliente: nombre,
      dni: boleta.requiere && boleta.tipo === "DNI" ? boleta.numero : undefined,
      whatsapp: telefonoNormalizado.e164,
      estado_ficha: "completa",
      updated_at: ahora,
    },
    "reserva_id"
  );

  if (citaUpdate.error) {
    return errorResponse(
      "validacion",
      `No se pudo cerrar la ficha: ${citaUpdate.error}`
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
          })
        )
      : whatsappUrlNegocio("Hola, tengo una consulta sobre mi cita.");

  const sedeInfo = await cargarSede(cita.sede);

  return NextResponse.json({
    ok: true,
    icsUrl,
    whatsappUrl,
    resumen: {
      ...construirCitaResumen(cita, sedeInfo),
      moneda: "PEN",
      adelantoRecibido: esCuponidad ? 0 : Number(cita.adelanto ?? 0),
      saldo:
        cita.saldo_pendiente != null
          ? Number(cita.saldo_pendiente)
          : Math.max(Number(cita.monto_total ?? 0) - Number(cita.adelanto ?? 0), 0),
    },
  });
}
