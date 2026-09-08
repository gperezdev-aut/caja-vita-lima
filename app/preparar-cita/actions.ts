"use server";

import { randomUUID } from "crypto";
import { requireModuleAccess } from "@/lib/auth";
import {
  calcularAdelantoRequerido,
  calcularCitaDomicilio,
  CANALES_FICHA,
  describirAtencionDomicilio,
  horarioDentroDeSede,
  pagoHabilitaToken,
  redondearDinero,
  tipoAtencionDesdeServicios,
  validarDatosDomicilio,
  type CanalFicha,
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

function parseCatalogNumber(value: unknown) {
  const parsed = Number(
    String(value ?? "")
      .replace(/S\//gi, "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );
  return Number.isFinite(parsed) ? parsed : 0;
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

function calcularExpiracion(fecha: string, hora: string, duracionMin: number) {
  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  return new Date(inicio.getTime() + duracionMin * 60_000).toISOString();
}

export async function buscarClienteFichaAction(crudo: string, pais: string) {
  await requireModuleAccess("preparar-cita");
  const normalizado = normalizarTelefonoE164(crudo, pais);
  if (!normalizado.ok) return { error: "Teléfono inválido.", cliente: "" };

  const result = await supabaseSelectWhere<{ cliente?: string }>(
    "clientes",
    `select=cliente&whatsapp_e164=eq.${encodeURIComponent(normalizado.e164)}&limit=1`
  );

  if (result.error) return { error: result.error, cliente: "" };
  return { cliente: String(result.data[0]?.cliente ?? ""), error: "" };
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
  if (personas !== 1 && personas !== 2) {
    return { ok: false, error: "La cantidad de personas debe ser 1 o 2." };
  }

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

  if (!fecha || fecha < fechaLima() || !hora || !sede || !cliente) {
    return { ok: false, error: "Completa cliente, sede, fecha y una fecha no pasada." };
  }
  if (!telefono.ok) {
    return { ok: false, error: "No se pudo normalizar el teléfono para el país elegido." };
  }
  if (canal !== "directo" && (esGiftCard || promoCode)) {
    return {
      ok: false,
      error: "Gift card y cupón promocional común solo se aplican al canal directo.",
    };
  }

  const serviceCodes = [text(formData, "servicio_1")];
  if (personas === 2) serviceCodes.push(text(formData, "servicio_2"));
  if (serviceCodes.some((code) => !code)) {
    return { ok: false, error: "Selecciona un servicio para cada persona." };
  }
  const tipoAtencion = tipoAtencionDesdeServicios(serviceCodes);
  if (tipoAtencion === "mezclado") {
    return { ok: false, error: "No se pueden mezclar servicios presenciales y a domicilio en una misma cita." };
  }

  const [catalogResult, promotionResult, sedeResult] = await Promise.all([
    supabaseSelect<Row>("stg_services_catalog_v5"),
    supabaseSelect<Row>("stg_promotions_v1"),
    supabaseSelectWhere<{
      nombre: string | null;
      hora_apertura: string | null;
      hora_cierre: string | null;
    }>(
      "sedes",
      `select=nombre,hora_apertura,hora_cierre&nombre=eq.${encodeURIComponent(sede)}&activo=is.true&limit=1`
    ),
  ]);

  const dataError = catalogResult.error || promotionResult.error || sedeResult.error;
  if (dataError) return { ok: false, error: `No se pudo validar la cita: ${dataError}` };

  const catalog = catalogResult.data.filter((row) => truthy(row.active));
  const servicios = serviceCodes.map((code) => {
    const row = catalog.find((item) => String(item.CodeId ?? "").trim() === code);
    if (!row) return null;
    return {
      codigo: code,
      nombre: String(row.option_name ?? "").trim(),
      duracion_min: Math.round(parseCatalogNumber(row.duration_min)),
      precio: redondearDinero(parseCatalogNumber(row.price_pen ?? row.price)),
    };
  });

  if (servicios.some((item) => !item?.nombre || !item.duracion_min)) {
    return { ok: false, error: "Uno de los servicios ya no está activo en el catálogo." };
  }

  const serviciosValidos = servicios.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const esDomicilio = tipoAtencion === "domicilio";
  if (esDomicilio) {
    const errorDomicilio = validarDatosDomicilio(
      { sedeOperativa: sede, distrito: distritoDomicilio, direccion: direccionDomicilio },
      sedeResult.data.map((item) => String(item.nombre ?? "").trim()).filter(Boolean)
    );
    if (errorDomicilio) return { ok: false, error: errorDomicilio };
    if (promoCode || esGiftCard) {
      return { ok: false, error: "Las promociones y gift cards no aplican a domicilio sin una regla específica configurada." };
    }
  }

  let montoTotal = redondearDinero(serviciosValidos.reduce((sum, item) => sum + item.precio, 0));
  let costoMovilidad = 0;
  let economiaDomicilio: ReturnType<typeof calcularCitaDomicilio> | null = null;

  if (esDomicilio) {
    economiaDomicilio = calcularCitaDomicilio(serviciosValidos);
    if (!economiaDomicilio.ok) return { ok: false, error: economiaDomicilio.error };
    montoTotal = economiaDomicilio.total;
    costoMovilidad = economiaDomicilio.movilidad;
  }

  if (promoCode && !esDomicilio) {
    const hoy = fechaLima();
    const promo = promotionResult.data.find((row) => {
      const inicio = String(row.start_date ?? "").slice(0, 10);
      const fin = String(row.end_date ?? "").slice(0, 10);
      return (
        String(row.promo_code ?? "").trim() === promoCode &&
        truthy(row.is_active) &&
        (!inicio || inicio <= hoy) &&
        (!fin || fin >= hoy)
      );
    });
    if (!promo) return { ok: false, error: "El cupón promocional no está vigente." };
    montoTotal = redondearDinero(
      parseCatalogNumber(personas === 2 ? promo.price_2p : promo.price_1p)
    );
  }

  if (montoTotal <= 0) {
    return { ok: false, error: "El catálogo no tiene un precio válido para esta cita." };
  }

  const serviciosPersistidos = servicios.map((item, index) => ({
    ...item,
    precio:
      promoCode && item
        ? index === servicios.length - 1
          ? redondearDinero(montoTotal - (montoTotal / personas) * index)
          : redondearDinero(montoTotal / personas)
        : item?.precio,
  }));
  const duracionMin = Math.max(
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

  const adelantoRequerido = calcularAdelantoRequerido({
    canal,
    personas,
    montoTotal,
    esGiftCard,
    esDomicilio,
  });
  if (!pagoHabilitaToken(montoPagado, adelantoRequerido)) {
    return {
      ok: false,
      error: `Registra al menos S/${adelantoRequerido.toFixed(2)} antes de generar el enlace.`,
    };
  }

  const metodoPago = text(formData, "metodo_pago");
  const numeroOperacion = text(formData, "numero_operacion");
  if (montoPagado > 0 && !metodoPago) {
    return { ok: false, error: "El método de pago es obligatorio." };
  }
  if (montoPagado > 0 && metodoPago.toUpperCase() !== "EFECTIVO" && !numeroOperacion) {
    return { ok: false, error: "El número de operación es obligatorio para pagos no efectivos." };
  }

  const token = generarTokenFicha();
  const reservaId = crearId("RES");
  const rpc = await supabaseRpc<{
    ok: boolean;
    reserva_id: string;
    token: string;
  }>("preparar_ficha_cita", {
    p_payload: {
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
      cliente,
      whatsapp_e164: telefono.e164,
      pais_telefono: telefono.pais,
      servicios: serviciosPersistidos,
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
      token_expira: calcularExpiracion(fecha, hora, duracionMin),
    },
  });

  if (rpc.error || !rpc.data?.ok) {
    return { ok: false, error: rpc.error || "La transacción no confirmó la cita." };
  }

  const enlace = `https://vitalimaspa.com/cita/${token}`;
  const ubicacionCliente = esDomicilio
    ? describirAtencionDomicilio({ distrito: distritoDomicilio, direccion: direccionDomicilio, referencia: referenciaDomicilio })
    : `en ${sede}`;
  const mensaje = `Hola ${cliente}, tu cita en Vita Lima quedó registrada para el ${fecha} a las ${hora}. ${ubicacionCliente}. Completa tu ficha aquí: ${enlace}`;

  return { ok: true, mensaje, enlace, reservaId };
}
