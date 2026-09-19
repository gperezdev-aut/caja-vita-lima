"use server";

import { redirect } from "next/navigation";
import { supabaseInsert } from "@/lib/supabaseServer";
import { requireModuleAccess } from "@/lib/auth";
import {
  esNaturalezaSalida,
  metodoForzadoPorNaturaleza,
  normalizarMetodoSalida,
  validarNaturalezaMetodo,
} from "@/lib/salidasCaja";

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function money(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function id(prefix: string) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-APP-${stamp}-${rand}`;
}

function errorUrl(message: string) {
  return `/registrar-salida?error=${encodeURIComponent(message)}`;
}

export async function createSalidaAction(formData: FormData) {
  await requireModuleAccess("registrar-salida");

  const fecha = clean(formData.get("fecha"));
  const hora = clean(formData.get("hora"));
  const sede = clean(formData.get("sede"));
  const naturalezaRaw = clean(formData.get("naturaleza_salida")) || "GASTO";
  const tipoGasto = clean(formData.get("tipo_gasto"));
  const metodoRaw = clean(formData.get("metodo_salida"));
  const concepto = clean(formData.get("concepto"));
  const monto = money(formData.get("monto"));
  const responsable = clean(formData.get("responsable")) || "Gerald";
  const sourceMovimientoId = clean(formData.get("source_movimiento_id"));
  const observacion = clean(formData.get("observacion"));

  if (!fecha || !hora || !sede || !naturalezaRaw || !metodoRaw || !concepto) {
    redirect(errorUrl("Completa fecha, hora, sede, naturaleza, método y concepto."));
  }

  if (!esNaturalezaSalida(naturalezaRaw)) {
    redirect(errorUrl("La naturaleza de la salida no es válida."));
  }

  if (naturalezaRaw === "GASTO" && !tipoGasto) {
    redirect(errorUrl("Selecciona la categoría del gasto."));
  }

  const metodoNormalizado = normalizarMetodoSalida(metodoRaw);
  if (!metodoNormalizado) {
    redirect(errorUrl("Selecciona un método de salida."));
  }

  const metodoForzado = metodoForzadoPorNaturaleza(naturalezaRaw);
  const metodoSalida = metodoForzado ?? metodoNormalizado;
  const combinacionError = validarNaturalezaMetodo(naturalezaRaw, metodoSalida);

  if (combinacionError) {
    redirect(errorUrl(combinacionError));
  }

  if (monto < 0) {
    redirect(errorUrl("El monto no puede ser negativo."));
  }

  if (naturalezaRaw === "GASTO") {
    const salidaId = id("SAL");

    const salida = await supabaseInsert("caja_salidas", {
      salida_id: salidaId,
      fecha,
      hora,
      sede,
      tipo_gasto: tipoGasto,
      concepto,
      monto,
      metodo_salida: metodoSalida,
      categoria_financiera: "GASTO_OPERATIVO",
      responsable,
      source_movimiento_id: sourceMovimientoId || null,
      observacion,
    });

    if (salida.error) {
      redirect(errorUrl(salida.error));
    }

    redirect(`/registrar-salida?ok=1&id=${encodeURIComponent(salidaId)}`);
  }

  const movimientoFondoId = id("FON");

  const movimiento = await supabaseInsert("caja_movimientos_fondos", {
    movimiento_fondo_id: movimientoFondoId,
    fecha,
    hora,
    sede,
    tipo_movimiento: naturalezaRaw,
    metodo: metodoSalida,
    concepto,
    monto,
    responsable,
    source_movimiento_id: sourceMovimientoId || null,
    observacion,
  });

  if (movimiento.error) {
    redirect(errorUrl(movimiento.error));
  }

  redirect(`/registrar-salida?ok=1&id=${encodeURIComponent(movimientoFondoId)}`);
}
