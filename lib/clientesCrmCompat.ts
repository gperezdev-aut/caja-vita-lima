export type ClienteCrmRow = Record<string, unknown>;

function texto(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Completa únicamente los valores seguros para un maestro que todavía no está
 * presente en la vista CRM heredada. Los campos CRM/catálogo desconocidos se
 * dejan ausentes: nunca se fabrican datos comerciales.
 */
export function clienteMaestroSinActividad(cliente: ClienteCrmRow): ClienteCrmRow {
  const whatsapp = texto(cliente.whatsapp);
  const tieneDatoParcial = Boolean(texto(cliente.email) || texto(cliente.dni));
  return {
    ...cliente,
    total_visitas: 0,
    total_gastado: 0,
    total_reservas: Number(cliente.total_reservas ?? 0),
    estado_actividad_crm: "SIN_ACTIVIDAD",
    calidad_contacto_crm: whatsapp
      ? "CON_WHATSAPP"
      : tieneDatoParcial
        ? "CON_DATO_PARCIAL"
        : "SIN_CONTACTO",
  };
}

/** Conserva íntegro el contrato de la vista heredada y solo agrega maestros faltantes. */
export function combinarClientesCrm(
  filasCrm: ClienteCrmRow[],
  maestros: ClienteCrmRow[],
  hoy = new Date().toISOString().slice(0, 10)
) {
  const porId = new Map<string, ClienteCrmRow>();
  for (const maestro of maestros) {
    const id = texto(maestro.cliente_id);
    if (id) porId.set(id, clienteMaestroSinActividad(maestro));
  }
  for (const filaCrm of filasCrm) {
    const id = texto(filaCrm.cliente_id);
    if (id) {
      const combinado = { ...(porId.get(id) ?? {}), ...filaCrm };
      const ultimaVisita = texto(combinado.ultima_visita_crm ?? combinado.ultima_visita);
      const ultimaReserva = texto(combinado.ultima_reserva_crm ?? combinado.ultima_reserva);
      // La vista heredada conserva todos sus campos, pero la actividad se
      // recalcula si aporta fechas para no elegir una visita antigua sobre una
      // reserva más reciente.
      porId.set(id, ultimaVisita || ultimaReserva
        ? { ...combinado, estado_actividad_crm: estadoActividadDesdeFechas(ultimaVisita, ultimaReserva, hoy) }
        : combinado);
    }
  }
  return [...porId.values()];
}

export function fechaActividadMasReciente(
  ultimaVisita: string | null | undefined,
  ultimaReserva: string | null | undefined
) {
  const visita = texto(ultimaVisita);
  const reserva = texto(ultimaReserva);
  if (!visita) return reserva || null;
  if (!reserva) return visita;
  return visita >= reserva ? visita : reserva;
}

export function estadoActividadDesdeFechas(
  ultimaVisita: string | null | undefined,
  ultimaReserva: string | null | undefined,
  hoy: string
) {
  const actividad = fechaActividadMasReciente(ultimaVisita, ultimaReserva);
  if (!actividad) return "SIN_ACTIVIDAD" as const;
  const limite = new Date(`${hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - 60);
  return actividad < limite.toISOString().slice(0, 10) ? "INACTIVO" as const : "ACTIVO" as const;
}
