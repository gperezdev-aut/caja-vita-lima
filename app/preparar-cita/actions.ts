"use server";

import { randomUUID } from "crypto";
import { requireModuleAccess } from "@/lib/auth";
import { leerCatalogoPrepararCita } from "@/lib/catalogoPrepararCita";
import {
  calcularEconomiaHome,
  servicioEsComponente,
  validarSeleccionCita,
} from "@/lib/catalogoPrepararCitaDominio";
import {
  calcularAdelantoRequerido,
  CANALES_FICHA,
  describirAtencionDomicilio,
  horarioDentroDeSede,
  redondearDinero,
  resolverExpiracionFichaVigente,
  calcularAtencionPersonalizada,
  validarDatosDomicilio,
  validarPreparacionMvp,
  validarPagoPreparacion,
  type CanalFicha,
  type PersonaPersonalizada,
} from "@/lib/fichaCitaDominio";
import { generarTokenFicha, normalizarTelefonoE164 } from "@/lib/fichaCitaPublica";
import {
  supabaseRpc,
  supabaseSelect,
  supabaseSelectWhere,
} from "@/lib/supabaseServer";

type Row = Record<string, unknown>;

export type PrepararCitaState = {
  ok: boolean;
  error?: string;
  mensaje?: string;
  enlace?: string;
  reservaId?: string;
};

const INITIAL_STATE: PrepararCitaState = { ok: false };

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function number(formData: FormData, name: string) {
  const value = Number(text(formData, name).replace(",", "."));
  return Number.isFinite(value) ? value : NaN;
}

function truthy(value: unknown) {
  return ["true", "1", "yes", "si", "sí"].includes(
    String(value ?? "").trim().toLowerCase()
  );
}

function fechaLima() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function crearId(prefix: string) {
  return `${prefix}-FICHA-${randomUUID().toUpperCase()}`;
}

export async function buscarClienteFichaAction(crudo: string, pais: string) {
  await requireModuleAccess("preparar-cita");
  const normalizado = normalizarTelefonoE164(crudo, pais);
  if (!normalizado.ok) return { error: "Teléfono inválido.", cliente: "", idioma: "" };

  const result = await supabaseSelectWhere<{ cliente?: string; idioma?: string }>(
    "clientes",
    `select=cliente,idioma&whatsapp_e164=eq.${encodeURIComponent(normalizado.e164)}&limit=1`
  );

  if (result.error) return { error: result.error, cliente: "", idioma: "" };
  return {
    cliente: String(result.data[0]?.cliente ?? ""),
    idioma: String(result.data[0]?.idioma ?? "es"),
    error: "",
  };
}

export async function prepararCitaAction(
  _previousState: PrepararCitaState = INITIAL_STATE,
  formData: FormData
): Promise<PrepararCitaState> {
  void _previousState;
  const session = await requireModuleAccess("preparar-cita");

  const canalRaw = text(formData, "canal");
  if (!CANALES_FICHA.includes(canalRaw as CanalFicha)) {
    return { ok: false, error: "Selecciona un canal válido." };
  }
  const canal = canalRaw as CanalFicha;
  const personas = Number.parseInt(text(formData, "personas"), 10);
  const esPersonalizada = text(formData, "atencion_personalizada") === "1";
  const confirmaDisponibilidad = truthy(formData.get("confirmar_disponibilidad"));
  if ((!esPersonalizada && personas !== 1 && personas !== 2) || (esPersonalizada && (personas < 1 || personas > 5))) return { ok: false, error: esPersonalizada ? "La cantidad de personas debe ser 1 a 5." : "La cantidad de personas debe ser 1 o 2." };

  const fecha = text(formData, "fecha");
  const hora = text(formData, "hora");
  const sede = text(formData, "sede");
  const cliente = text(formData, "cliente");
  const pais = text(formData, "pais").toUpperCase();
  const telefono = normalizarTelefonoE164(text(formData, "telefono"), pais);
  const esGiftCard = text(formData, "es_gift_card") === "1";
  const promoCode = text(formData, "promo_code");
  const montoPagado = number(formData, "monto_pagado");
  const distritoDomicilio = text(formData, "domicilio_distrito");
  const direccionDomicilio = text(formData, "domicilio_direccion");
  const referenciaDomicilio = text(formData, "domicilio_referencia");
  const requestId = text(formData, "request_id");

  if (!fecha || fecha < fechaLima() || !hora || !sede || !cliente) {
    return { ok: false, error: "Completa cliente, sede, fecha y una fecha no pasada." };
  }
  if (!telefono.ok) {
    return { ok: false, error: "No se pudo normalizar el teléfono para el país elegido." };
  }
  const errorMvp = validarPreparacionMvp({ canal, esGiftCard, cuponPromocional: promoCode });
  if (errorMvp) return { ok: false, error: errorMvp };
  if (esPersonalizada && (canal !== "directo" || text(formData, "tipo_atencion") !== "sede")) return { ok: false, error: "La atención personalizada solo admite canal directo y atención presencial." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return { ok: false, error: "El identificador del intento no es válido. Recarga el formulario." };
  }

  let componentesPersonalizados: PersonaPersonalizada[] | null = null;
  if (esPersonalizada) {
    try { componentesPersonalizados = JSON.parse(text(formData, "componentes")); } catch { return { ok: false, error: "Los componentes personalizados no son válidos." }; }
    if (!Array.isArray(componentesPersonalizados)) return { ok: false, error: "Los componentes personalizados no son válidos." };
  }
  const serviceCodes = esPersonalizada
    ? componentesPersonalizados!.flatMap((p) => p.componentes.filter((c) => c.tipo === "catalogo").map((c) => c.codigo ?? ""))
    : [text(formData, "servicio_1"), text(formData, "servicio_2")].filter(Boolean);
  if (!esPersonalizada && !serviceCodes.length) return { ok: false, error: "Selecciona un servicio." };

  const [catalogResult, sedeResult, metodosResult] = await Promise.all([
    leerCatalogoPrepararCita(),
    supabaseSelectWhere<{
      nombre: string | null;
      hora_apertura: string | null;
      hora_cierre: string | null;
    }>(
      "sedes",
      `select=nombre,hora_apertura,hora_cierre&nombre=eq.${encodeURIComponent(sede)}&activo=is.true&limit=1`
    ),
    supabaseSelect<Row>("config_listas"),
  ]);

  const dataError = ("error" in catalogResult ? catalogResult.error : "") || sedeResult.error || metodosResult.error;
  if (dataError) return { ok: false, error: `No se pudo validar la cita: ${dataError}` };

  if (!catalogResult.ok) return { ok: false, error: "El snapshot canónico local no está disponible." };
  const catalogByCode = new Map(catalogResult.services.map((service) => [service.serviceCode, service]));
  const canonicalServices = serviceCodes.map((code) => catalogByCode.get(code));
  if (canonicalServices.some((service) => !service)) {
    return { ok: false, error: "Cada código debe corresponder a un servicio único del snapshot activo." };
  }
  const serviciosCanonicos = canonicalServices.filter((service) => service !== undefined);
  const serviciosValidos = serviciosCanonicos.map((service) => ({
    codigo: service.serviceCode, nombre: service.nameEs, duracion_min: service.durationMin,
    precio: service.pricePen, release_id: service.releaseId, price_version: service.priceVersion,
  }));
  const seleccion = esPersonalizada ? null : validarSeleccionCita(personas, serviciosCanonicos);
  if (seleccion && !seleccion.ok) return { ok: false, error: seleccion.error };
  const tipoAtencion = esPersonalizada ? "sede" : seleccion!.tipoAtencion;
  if (esPersonalizada) {
    const porCodigo = new Map(serviciosCanonicos.map((service) => [service.serviceCode, service]));
    for (const persona of componentesPersonalizados!) for (const componente of persona.componentes) {
      if (componente.tipo === "catalogo") { const servicio = porCodigo.get(componente.codigo ?? ""); if (!servicio || !servicioEsComponente(servicio)) return { ok:false, error:"Un servicio de catálogo no es elegible como componente." }; componente.nombre=servicio.nameEs; componente.precio=servicio.pricePen; componente.duracion_min=servicio.durationMin; Object.assign(componente, { release_id: servicio.releaseId, price_version: servicio.priceVersion }); }
    }
  }
  const esDomicilio = tipoAtencion === "domicilio";
  if (esDomicilio) {
    const errorDomicilio = validarDatosDomicilio(
      { sedeOperativa: sede, distrito: distritoDomicilio, direccion: direccionDomicilio },
      sedeResult.data.map((item) => String(item.nombre ?? "").trim()).filter(Boolean)
    );
    if (errorDomicilio) return { ok: false, error: errorDomicilio };
  }

  const personalizada = esPersonalizada ? calcularAtencionPersonalizada({ personas, modalidad: text(formData,"modalidad") === "consecutiva" ? "consecutiva" : "simultanea", componentes: componentesPersonalizados!, precioFinal: text(formData,"precio_final") ? number(formData,"precio_final") : null, motivoAjuste:text(formData,"motivo_ajuste"), confirmaDisponibilidad }) : null;
  if (personalizada && !personalizada.ok) return { ok:false, error: personalizada.error };
  if (personalizada?.ok && personalizada.diferencia !== 0 && !session.nombre.trim()) {
    return { ok: false, error: "No se pudo identificar al responsable del ajuste." };
  }
  let montoTotal = personalizada?.ok ? personalizada.precioFinal : redondearDinero(serviciosValidos.reduce((sum, item) => sum + item.precio, 0));
  let costoMovilidad = 0;
  let economiaDomicilio: ReturnType<typeof calcularEconomiaHome> | null = null;

  if (esDomicilio) {
    economiaDomicilio = calcularEconomiaHome(serviciosCanonicos, distritoDomicilio, catalogResult.homePolicies);
    if (!economiaDomicilio.ok) return { ok: false, error: economiaDomicilio.error };
    if (economiaDomicilio.feePen === null || economiaDomicilio.total === null) return { ok: false, error: "El distrito requiere confirmar manualmente la movilidad antes de guardar." };
    montoTotal = economiaDomicilio.total;
    costoMovilidad = economiaDomicilio.feePen;
  }

  if (montoTotal <= 0) {
    return { ok: false, error: "El catálogo no tiene un precio válido para esta cita." };
  }

  const serviciosPersistidos = personalizada?.ok ? personalizada.componentes.flatMap((p) => p.componentes.map((c) => ({...c, persona:p.persona}))) : serviciosValidos;
  const duracionMin = personalizada?.ok ? personalizada.duracionMin : Math.max(
    ...serviciosPersistidos.map((item) => item?.duracion_min ?? 0)
  );
  const sedeHorario = sedeResult.data[0];
  if (
    !sedeHorario?.hora_apertura ||
    !sedeHorario.hora_cierre ||
    !horarioDentroDeSede(
      hora,
      duracionMin,
      sedeHorario.hora_apertura,
      sedeHorario.hora_cierre
    )
  ) {
    return { ok: false, error: "La cita terminaría fuera del horario de la sede." };
  }
  const expiracionFicha = resolverExpiracionFichaVigente(fecha, hora, duracionMin);
  if (!expiracionFicha.ok) {
    return { ok: false, error: "La hora seleccionada ya terminó. Elige una hora vigente antes de generar el enlace." };
  }

  const adelantoRequerido = personalizada?.ok ? personalizada.adelantoRequerido : calcularAdelantoRequerido({
    canal,
    personas,
    montoTotal,
    esGiftCard,
    esDomicilio,
  });
  const metodoPago = text(formData, "metodo_pago");
  const numeroOperacion = text(formData, "numero_operacion");
  const metodosPermitidos = metodosResult.data
    .filter((row) => row.lista === "METODOS_PAGO" && truthy(row.activo))
    .map((row) => String(row.valor ?? "").trim())
    .filter(Boolean);
  const errorPago = validarPagoPreparacion({
    montoPagado,
    adelantoRequerido,
    total: montoTotal,
    metodoPago,
    numeroOperacion,
    metodosPermitidos,
  });
  if (errorPago) return { ok: false, error: errorPago };

  const token = generarTokenFicha();
  const reservaId = crearId("RES");
  const rpc = await supabaseRpc<{
    ok: boolean;
    reserva_id: string;
    token: string;
  }>(esPersonalizada ? "preparar_atencion_personalizada" : "preparar_ficha_cita", {
    p_payload: {
      request_id: requestId,
      canal,
      personas,
      fecha,
      hora,
      sede,
      tipo_atencion: tipoAtencion,
      sede_operativa: sede,
      domicilio_distrito: esDomicilio ? distritoDomicilio : null,
      domicilio_direccion: esDomicilio ? direccionDomicilio : null,
      domicilio_referencia: esDomicilio ? referenciaDomicilio || null : null,
      costo_movilidad: costoMovilidad,
      home_policy_id: economiaDomicilio?.ok ? economiaDomicilio.policy.policyId : null,
      home_policy_sha256: economiaDomicilio?.ok ? economiaDomicilio.policy.policySha256 : null,
      cliente,
      whatsapp_e164: telefono.e164,
      pais_telefono: telefono.pais,
      servicios: serviciosPersistidos,
      atencion_personalizada: esPersonalizada,
      modalidad_ejecucion: esPersonalizada ? text(formData,"modalidad") : null,
      componentes_por_persona: esPersonalizada ? componentesPersonalizados : null,
      precio_calculado: personalizada?.ok ? personalizada.precioCalculado : montoTotal,
      precio_final_acordado: montoTotal,
      diferencia_precio: personalizada?.ok ? personalizada.diferencia : 0,
      motivo_ajuste: personalizada?.ok && personalizada.diferencia !== 0 ? text(formData,"motivo_ajuste") : null,
      confirmar_disponibilidad: confirmaDisponibilidad,
      monto_total: montoTotal,
      monto_pagado: montoPagado,
      metodo_pago: metodoPago,
      numero_operacion: numeroOperacion,
      responsable: session.nombre,
      observacion: text(formData, "observacion"),
      idioma: text(formData, "idioma") || "es",
      es_gift_card: esGiftCard,
      cupon_promocional: promoCode || null,
      cliente_id: crearId("CLI"),
      movimiento_id: crearId("MOV"),
      reserva_id: reservaId,
      pago_id: crearId("PAY"),
      token,
      token_expira: expiracionFicha.tokenExpira,
    },
  });

  if (rpc.error || !rpc.data?.ok) {
    if (rpc.error?.includes("REQUEST_ID_PAYLOAD_CONFLICTO")) {
      return { ok: false, error: "Este intento ya fue usado con datos diferentes. Recarga el formulario y vuelve a revisar la cita." };
    }
    return { ok: false, error: "La transacción no confirmó la cita. No se guardó ningún cambio parcial." };
  }

  const tokenConfirmado = rpc.data.token;
  const reservaConfirmada = rpc.data.reserva_id;
  const enlace = `https://vitalimaspa.com/cita/${tokenConfirmado}`;
  const ubicacionCliente = esDomicilio
    ? describirAtencionDomicilio({ distrito: distritoDomicilio, direccion: direccionDomicilio, referencia: referenciaDomicilio })
    : `en ${sede}`;
  const mensaje = esDomicilio
    ? `Hola ${cliente}, tu solicitud de atención a domicilio quedó registrada para el ${fecha} a las ${hora} y está pendiente de confirmación de cobertura y terapistas. ${ubicacionCliente}. Completa tu ficha aquí: ${enlace}`
    : `Hola ${cliente}, tu cita en Vita Lima quedó registrada para el ${fecha} a las ${hora}. ${ubicacionCliente}. Completa tu ficha aquí: ${enlace}`;

  return { ok: true, mensaje, enlace, reservaId: reservaConfirmada };
}
