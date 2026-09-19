export type CierreDraft = {
  fecha: string;
  sede: string;
  responsable: string;
  cajaInicial: string;
  efectivoContado: string;
  fondoSiguiente: string;
};

function validNonNegativeMoney(value: string) {
  if (!value.trim()) return false;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0;
}

export function validateCierreStep(step: number, draft: CierreDraft) {
  if (step === 1 && (!draft.fecha || !draft.sede || !draft.responsable)) {
    return "Completa fecha, sede y responsable.";
  }

  if (step === 2) {
    if (
      !validNonNegativeMoney(draft.cajaInicial) ||
      !validNonNegativeMoney(draft.efectivoContado) ||
      !validNonNegativeMoney(draft.fondoSiguiente)
    ) {
      return "Ingresa montos válidos que no sean negativos.";
    }

    const contado = Number(draft.efectivoContado.replace(",", "."));
    const fondo = Number(draft.fondoSiguiente.replace(",", "."));

    if (fondo > contado) {
      return "El fondo para el siguiente día no puede ser mayor que el efectivo contado.";
    }
  }

  return "";
}

export function physicalValue(value: number | null) {
  return value == null ? "No calculable" : value;
}
