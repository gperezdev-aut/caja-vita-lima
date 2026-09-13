export type CierreDraft = {
  fecha: string;
  sede: string;
  responsable: string;
  cajaInicial: string;
  efectivoContado: string;
  pozoFondo: string;
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

  if (
    step === 2 &&
    (!validNonNegativeMoney(draft.cajaInicial) ||
      !validNonNegativeMoney(draft.efectivoContado) ||
      !validNonNegativeMoney(draft.pozoFondo))
  ) {
    return "Ingresa montos válidos que no sean negativos.";
  }

  return "";
}

export function physicalValue(value: number | null) {
  return value == null ? "No calculable" : value;
}
