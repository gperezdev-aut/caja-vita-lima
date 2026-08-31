"use server";

import { redirect } from "next/navigation";
import {
  supabaseInsert,
  supabaseSelectWhere,
  supabaseUpsert,
} from "@/lib/supabaseServer";
import { requireModuleAccess } from "@/lib/auth";

type ClienteRow = {
  cliente_id: string;
};

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function money(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function intValue(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function id(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-APP-${stamp}-${rand}`;
}

function comprobanteFromEstado(estadoBoleta: string, numeroBoleta: string) {
  const estado = estadoBoleta.toLowerCase();

  if (estado.includes("no aplica")) {
    return {
      tipo_comprobante: "NO_APLICA",
      estado_comprobante_manual: "NO_APLICA",
    };
  }

  if (estado.includes("fact")) {
    return {
      tipo_comprobante: "FACTURA",
      estado_comprobante_manual: numeroBoleta ? "OK" : "PENDIENTE",
    };
  }

  if (estado.includes("emit")) {
    return {
      tipo_comprobante: "BOLETA",
      estado_comprobante_manual: numeroBoleta ? "OK" : "OBSERVAR",
    };
  }

  if (estado.includes("pend")) {
    return {
      tipo_comprobante: "POR_DEFINIR",
      estado_comprobante_manual: "PENDIENTE",
    };
  }

  return {
    tipo_comprobante: numeroBoleta ? "BOLETA" : "POR_DEFINIR",
    estado_comprobante_manual: numeroBoleta ? "OK" : "PENDIENTE",
  };
}

async function getOrCreateCliente({
  cliente,
  whatsapp,
  dni,
  sede,
  fecha,
  servicio,
}: {
  cliente: string;
  whatsapp: string;
  dni: string;
  sede: string;
  fecha: string;
  servicio: string;
}) {
  let clienteId = "";

  if (whatsapp) {
    const existing = await supabaseSelectWhere<ClienteRow>(
      "clientes",
      `select=cliente_id&whatsapp=eq.${encodeURIComponent(whatsapp)}&limit=1`
    );

    if (existing.error) {
      redirect(`/nueva-atencion?error=${encodeURIComponent(existing.error)}`);
    }

    clienteId = existing.data?.[0]?.cliente_id ?? "";
  }

  if (!clienteId) {
    clienteId = id("CLI");
  }

  const upsert = await supabaseUpsert(
    "clientes",
    {
      cliente_id: clienteId,
      cliente,
      whatsapp: whatsapp || null,
      dni: dni || null,
      ultima_sede: sede || null,
      ultima_visita: fecha || null,
      ultimo_servicio: servicio || null,
      origen: "APP_CAJA",
      updated_at: new Date().toISOString(),
    },
    "cliente_id"
  );

  if (upsert.error) {
    redirect(`/nueva-atencion?error=${encodeURIComponent(upsert.error)}`);
  }

  return clienteId;
}


function isAdminSession(session: unknown) {
  const role = String(
    (session as Record<string, unknown>)?.role ??
    (session as Record<string, unknown>)?.rol ??
    ""
  ).toUpperCase();

  return ["ADMIN_GERALD", "ADMIN", "ADMINISTRADOR"].includes(role);
}

async function saveCustomServiceToCatalog({
  name,
  duration,
  price,
  nPax,
}: {
  name: string;
  duration: string;
  price: number;
  nPax: number;
}) {
  const durationNumber = Number.parseInt(duration, 10) || 60;
  const code = `CUSTOM-${nPax}P-${Date.now().toString(36).toUpperCase()}`;

  return supabaseInsert("stg_services_catalog_v5", {
    CodeId: code,
    category: `${nPax}p`,
    option_name: name,
    duration_min: String(durationNumber),
    price: `S/ ${price}`,
    includes: "Servicio personalizado creado desde Caja Vita Lima",
    tags: "personalizado,caja",
    sede: "Ambas",
    active: "True",
    modality_allowed: "CUSTOM",
    sort_order: 999,
    whatsapp_summary: `${name} — ${durationNumber} min — S/${price}`,
    whatsapp_detail: `${name}\n${durationNumber} min · S/${price}`,
    service_mode: "IN_BRANCH",
    requires_sede: "True",
    requires_address: "False",
    price_pen: String(price),
    service_code: code,
    pax_type: `${nPax}p`,
    menu_group: "PERSONALIZADOS",
    giftcard_enabled: "False",
  });
}

export async function lookupClienteAlertaAction(whatsapp: string, dni: string) {
  await requireModuleAccess("nueva-atencion");

  const cleanWhatsapp = clean(whatsapp);
  const cleanDni = clean(dni);

  if (!cleanWhatsapp && !cleanDni) {
    return { cliente: "", alerta: "" };
  }

  const filter = cleanWhatsapp
    ? `whatsapp=eq.${encodeURIComponent(cleanWhatsapp)}`
    : `dni=eq.${encodeURIComponent(cleanDni)}`;

  const result = await supabaseSelectWhere<{ cliente?: string; alerta_atencion?: string }>(
    "clientes",
    `select=cliente,alerta_atencion&${filter}&limit=1`
  );

  const row = result.data?.[0];

  return {
    cliente: String(row?.cliente ?? "").trim(),
    alerta: String(row?.alerta_atencion ?? "").trim(),
  };
}

export async function createAtencionAction(formData: FormData) {
  const session = await requireModuleAccess("nueva-atencion");
  const confirmarGuardado = clean(formData.get("confirmar_guardado"));

  if (confirmarGuardado !== "SI") {
    redirect(
      "/nueva-atencion?error=Debes revisar el resumen y presionar Confirmar y guardar."
    );
  }
  const tipoRegistro = clean(formData.get("tipo_registro")) || "ATENCION";
  const fecha = clean(formData.get("fecha"));
  const hora = clean(formData.get("hora"));
  const sede = clean(formData.get("sede"));
  const cliente = clean(formData.get("cliente"));
  const whatsapp = clean(formData.get("whatsapp"));
  const dni = clean(formData.get("dni"));
  const servicio = clean(formData.get("servicio"));
  const duracion = clean(formData.get("duracion"));
  const nPax = intValue(formData.get("n_pax"));
  const montoTotal = money(formData.get("monto_total"));
  const montoPagado = money(formData.get("monto_pagado"));
  const metodoPago = clean(formData.get("metodo_pago"));
  const estadoBoleta = clean(formData.get("estado_boleta")) || "Pendiente";
  const numeroBoleta = clean(formData.get("numero_boleta"));
  const responsable = clean(formData.get("responsable")) || "Gerald";
  const terapista1 = clean(formData.get("terapista_1"));
  const terapista2 = clean(formData.get("terapista_2"));
  const observacionBase = clean(formData.get("observacion"));
  const customService = clean(formData.get("custom_service")) === "1";
  const customServiceName = clean(formData.get("custom_service_name"));
  const saveToCatalog = clean(formData.get("save_to_catalog")) === "1";
  const serviceCode = clean(formData.get("service_code"));
  const promoCode = clean(formData.get("promo_code"));
  const estadoPago = clean(formData.get("estado_pago"));
  const referencias = [
    serviceCode ? `Servicio catálogo: ${serviceCode}` : "",
    promoCode ? `Promoción: ${promoCode}` : "",
    estadoPago ? `Estado de pago: ${estadoPago}` : "",
    customService ? "Servicio personalizado" : "",
  ].filter(Boolean);
  const observacion = [observacionBase, ...referencias]
    .filter(Boolean)
    .join(" | ");

  if (!fecha || !hora || !sede || !cliente || !servicio) {
    redirect("/nueva-atencion?error=Completa fecha, hora, sede, cliente y servicio.");
  }

  if (montoTotal < 0 || montoPagado < 0) {
    redirect("/nueva-atencion?error=Los montos no pueden ser negativos.");
  }

  if (montoPagado > montoTotal) {
    redirect(
      "/nueva-atencion?error=El monto pagado no puede superar el monto total."
    );
  }

  if (whatsapp && !/^\d{9}$/.test(whatsapp)) {
    redirect("/nueva-atencion?error=El WhatsApp debe tener 9 dígitos.");
  }

  if (dni && !/^\d{8}$/.test(dni)) {
    redirect("/nueva-atencion?error=El DNI debe tener 8 dígitos.");
  }

  if (customService && !customServiceName) {
    redirect("/nueva-atencion?error=Ingresa el nombre del servicio personalizado.");
  }

  if (saveToCatalog && customService && isAdminSession(session)) {
    const savedService = await saveCustomServiceToCatalog({
      name: customServiceName,
      duration: duracion,
      price: montoTotal,
      nPax,
    });

    if (savedService.error) {
      redirect(
        `/nueva-atencion?error=${encodeURIComponent(
          `La atención no se guardó porque falló el nuevo servicio: ${savedService.error}`
        )}`
      );
    }
  }

  const clienteId = await getOrCreateCliente({
    cliente,
    whatsapp,
    dni,
    sede,
    fecha,
    servicio,
  });

  const movimientoId = id("MOV");
  const reservaId = id("RES");
  const sourceId = `${tipoRegistro}-${movimientoId}`;
  const pendiente = Math.max(montoTotal - montoPagado, 0);
  const comprobante = comprobanteFromEstado(estadoBoleta, numeroBoleta);

  const mov = await supabaseInsert("caja_movimientos", {
    movimiento_id: movimientoId,
    fecha,
    hora,
    sede,
    tipo_movimiento:
      tipoRegistro === "RESERVA" ? "RESERVA_APP" : "ATENCION_APP",
    estado: tipoRegistro === "RESERVA" ? "Reservado" : "Registrado",
    cliente_id: clienteId,
    cliente,
    whatsapp: whatsapp || null,
    dni: dni || null,
    n_pax: nPax,
    servicio,
    duracion: duracion || null,
    monto_servicio: montoTotal,
    adelanto_prev: tipoRegistro === "RESERVA" ? montoPagado : 0,
    metodo_adelanto_prev: tipoRegistro === "RESERVA" ? metodoPago || null : null,
    total_cobrar: montoTotal,
    total_pagado: montoPagado,
    total_extras: 0,
    pendiente,
    estado_boleta: estadoBoleta,
    numero_boleta: numeroBoleta || null,
    responsable,
    source_type: "APP_CAJA",
    source_id: sourceId,
    observacion,
    tipo_comprobante: comprobante.tipo_comprobante,
    estado_comprobante_manual: comprobante.estado_comprobante_manual,
    numero_comprobante_final: numeroBoleta || null,
    fecha_emision_comprobante:
      numeroBoleta && comprobante.estado_comprobante_manual === "OK"
        ? fecha
        : null,
  });

  if (mov.error) {
    redirect(`/nueva-atencion?error=${encodeURIComponent(mov.error)}`);
  }

  const cita = await supabaseInsert("citas_reservadas", {
    reserva_id: reservaId,
    fecha_cita: fecha,
    hora_cita: hora,
    sede,
    cliente_id: clienteId,
    cliente,
    dni: dni || null,
    whatsapp: whatsapp || null,
    n_pax: nPax,
    servicio,
    duracion: duracion || null,
    monto_total: montoTotal,
    adelanto: montoPagado,
    metodo_adelanto: metodoPago || null,
    saldo_pendiente: pendiente,
    estado: tipoRegistro === "RESERVA" ? "PENDIENTE" : "ATENDIDA_APP",
    source: "APP_CAJA",
    source_id: movimientoId,
    observacion,
  });

  if (cita.error) {
    redirect(`/nueva-atencion?error=${encodeURIComponent(cita.error)}`);
  }

  if (montoPagado > 0) {
    const pago = await supabaseInsert("caja_pagos", {
      pago_id: id("PAY"),
      movimiento_id: movimientoId,
      fecha,
      hora,
      sede,
      tipo_pago: tipoRegistro === "RESERVA" ? "ADELANTO_APP" : "PAGO_APP",
      metodo: metodoPago || "OTRO",
      metodo_detalle: null,
      monto: montoPagado,
      concepto: servicio,
    });

    if (pago.error) {
      redirect(`/nueva-atencion?error=${encodeURIComponent(pago.error)}`);
    }
  }

  const montoAsignado = nPax > 0 ? montoTotal / nPax : montoTotal;
  const detalleRows = [
    {
      detalle_id: `${id("DET")}-1`,
      movimiento_id: movimientoId,
      fecha,
      sede,
      persona_n: 1,
      terapista: terapista1 || "Por asignar",
      terapista_otro: null,
      servicio,
      duracion: duracion || null,
      monto_asignado: montoAsignado,
      observacion,
    },
  ];

  if (nPax >= 2) {
    detalleRows.push({
      detalle_id: `${id("DET")}-2`,
      movimiento_id: movimientoId,
      fecha,
      sede,
      persona_n: 2,
      terapista: terapista2 || "Por asignar",
      terapista_otro: null,
      servicio,
      duracion: duracion || null,
      monto_asignado: montoAsignado,
      observacion,
    });
  }

  const detalle = await supabaseInsert("caja_atencion_detalle", detalleRows);

  if (detalle.error) {
    redirect(`/nueva-atencion?error=${encodeURIComponent(detalle.error)}`);
  }

  redirect(`/nueva-atencion?ok=1&id=${encodeURIComponent(movimientoId)}`);
}
