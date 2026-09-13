export type SalidaDraft = {
  fecha: string;
  hora: string;
  sede: string;
  tipoGasto: string;
  concepto: string;
  monto: string;
  responsable: string;
};

export function validateSalidaStep(step: number, draft: SalidaDraft) {
  if (step === 1) {
    if (!draft.fecha || !draft.hora || !draft.sede || !draft.tipoGasto) {
      return "Completa fecha, hora, sede y tipo de gasto.";
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
