export type SalidaDraft = {
  fecha: string;
  hora: string;
  sede: string;
  naturalezaSalida: string;
  tipoGasto: string;
  metodoSalida: string;
  concepto: string;
  monto: string;
  responsable: string;
};

export function validateSalidaStep(step: number, draft: SalidaDraft) {
  if (step === 1) {
    if (
      !draft.fecha ||
      !draft.hora ||
      !draft.sede ||
      !draft.naturalezaSalida ||
      !draft.metodoSalida
    ) {
      return "Completa fecha, hora, sede, naturaleza y método.";
    }

    if (draft.naturalezaSalida === "GASTO" && !draft.tipoGasto) {
      return "Selecciona la categoría del gasto.";
    }

    if (
      (draft.naturalezaSalida === "RETIRO_CAJA" ||
        draft.naturalezaSalida === "AJUSTE_CAJA") &&
      draft.metodoSalida !== "EFECTIVO"
    ) {
      return "Los retiros y ajustes de caja deben registrarse como EFECTIVO.";
    }

    if (
      draft.naturalezaSalida === "TRANSFERENCIA" &&
      draft.metodoSalida === "EFECTIVO"
    ) {
      return "Una transferencia interna no puede usar EFECTIVO. Usa Retiro / depósito de efectivo.";
    }
  }

  if (step === 2) {
    if (!draft.concepto.trim()) return "Ingresa el concepto de la salida.";
    if (!draft.monto.trim()) return "Ingresa el monto de la salida.";

    const monto = Number(draft.monto.replace(",", "."));
    if (!Number.isFinite(monto) || monto < 0) {
      return "Ingresa un monto válido que no sea negativo.";
    }

    if (!draft.responsable) return "Selecciona un responsable.";
  }

  return "";
}
