import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import {
  supabaseInsert,
  supabaseSelectWhere,
  supabaseUpsert,
} from "@/lib/supabaseServer";
import {
  enmascararEmail,
  fichaErrorBody,
  fichaErrorStatus,
  normalizarTelefonoE164,
  plataformaDesdeCanal,
  POLITICA_CANCELACION_URL_DEFAULT,
  SEDE_INFO,
  type FichaErrorCode,
} from "@/lib/fichaCitaPublica";

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

const MAX_INTENTOS = 20;
const BLOQUEO_MINUTOS = 15;

type CitaRow = {
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
};

type ClienteRow = {
  cliente_id: string;
  cliente: string | null;
  email: string | null;
  whatsapp: string | null;
};

type CuponRow = {
  registro_id: string;
  vigente_hasta: string | null;
};

type IntentoRow = {
  ip: string;
  token: string;
  intentos: number | null;
  bloqueado_hasta: string | null;
};

function errorResponse(code: FichaErrorCode, mensaje: string) {
  return NextResponse.json(fichaErrorBody(code, mensaje), {
    status: fichaErrorStatus(code),
  });
}

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function verificarSecreto(request: NextRequest) {
  const esperado = getServerEnv("CAJA_API_SECRET");
  const recibido = request.headers.get("x-caja-secret") ?? "";
  return Boolean(esperado) && recibido === esperado;
}

async function checkRateLimit(ip: string, token: string) {
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

async function registrarIntentoFallido(
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

async function limpiarIntentos(ip: string, token: string) {
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

async function cargarCitaPorToken(token: string) {
  const result = await supabaseSelectWhere<CitaRow>(
    "citas_reservadas",
    [
      "select=reserva_id,cliente_id,fecha_cita,hora_cita,sede,n_pax,personas,servicio,duracion_min,monto_total,adelanto,saldo_pendiente,estado_ficha,token_expira,canal,idioma",
      `token_ficha=eq.${encodeURIComponent(token)}`,
      "limit=1",
    ].join("&")
  );

  if (result.error) {
    throw new Error(result.error);
  }

  return result.data?.[0] ?? null;
}

function construirCitaResumen(cita: CitaRow) {
  const sedeInfo = cita.sede ? SEDE_INFO[cita.sede] : undefined;

  return {
    fecha: cita.fecha_cita,
    hora: cita.hora_cita ? String(cita.hora_cita).slice(0, 5) : cita.hora_cita,
    sede: cita.sede,
    sedeDireccion: sedeInfo?.direccion ?? null,
    sedeMapsUrl: sedeInfo?.mapsUrl ?? null,
    personas: cita.personas ?? cita.n_pax ?? 1,
    servicios: cita.servicio
      ? [{ nombre: cita.servicio, duracionMin: cita.duracion_min ?? null }]
      : [],
    duracionTotalMin: cita.duracion_min ?? null,
  };
}

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

  let cliente: ClienteRow | null = null;
  if (cita.cliente_id) {
    const clienteResult = await supabaseSelectWhere<ClienteRow>(
      "clientes",
      [
        "select=cliente_id,cliente,email,whatsapp",
        `cliente_id=eq.${encodeURIComponent(cita.cliente_id)}`,
        "limit=1",
      ].join("&")
    );
    cliente = clienteResult.data?.[0] ?? null;
  }

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

  const body: Record<string, unknown> = {
    token,
    estado: cita.estado_ficha ?? "pendiente",
    idioma: cita.idioma ?? "es",
    canal,
    cita: construirCitaResumen(cita),
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
    politicaCancelacionUrl: POLITICA_CANCELACION_URL_DEFAULT,
  };

  if (esCuponidad) {
    const cuponResult = await supabaseSelectWhere<CuponRow>(
      "cupones_convenios",
      [
        "select=registro_id,vigente_hasta",
        `reserva_id=eq.${encodeURIComponent(cita.reserva_id)}`,
        "order=created_at.desc",
        "limit=1",
      ].join("&")
    );
    const cupon = cuponResult.data?.[0];
    body.cupon = { vigenteHasta: cupon?.vigente_hasta ?? null };
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

  const consentimientos = payload.consentimientos ?? {};
  if (!consentimientos.datos) {
    return errorResponse("validacion", "Falta aceptar el consentimiento de datos.");
  }
  if (!consentimientos.salud) {
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

  const salud = payload.salud ?? {};
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

  // El .ics real y el mensaje de WhatsApp no son parte de estos dos
  // endpoints (fuera del alcance pedido): estas URLs son un
  // placeholder de forma hasta que se construyan esas rutas.
  // ⚠️ PENDIENTE: implementar GET /api/publico/ficha/[token]/ics y
  // decidir qué arma exactamente whatsappUrl.
  const baseUrl = new URL(request.url).origin;
  const icsUrl = `${baseUrl}/api/publico/ficha/${token}/ics`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `Cita confirmada: ${cita.servicio ?? ""} el ${cita.fecha_cita} ${cita.hora_cita ?? ""} en ${cita.sede ?? ""}.`
  )}`;

  return NextResponse.json({
    ok: true,
    icsUrl,
    whatsappUrl,
    resumen: {
      ...construirCitaResumen(cita),
      moneda: "PEN",
      adelantoRecibido: esCuponidad ? 0 : Number(cita.adelanto ?? 0),
      saldo:
        cita.saldo_pendiente != null
          ? Number(cita.saldo_pendiente)
          : Math.max(Number(cita.monto_total ?? 0) - Number(cita.adelanto ?? 0), 0),
    },
  });
}
