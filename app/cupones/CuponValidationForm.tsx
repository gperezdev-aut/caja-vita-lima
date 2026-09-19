"use client";

import { useActionState, useMemo, useState } from "react";
import { asignarBeneficioConvenioAction, type CuponActionState } from "./actions";
import styles from "./CuponesPage.module.css";

export type ConvenioBenefit = {
  code: string;
  provider: "cuponidad" | "bee";
  name: string;
  included: string;
  duration: number;
  sessions: number;
  restrictedBranch: string;
};

type Props = {
  registroId: string;
  provider: "cuponidad" | "bee";
  benefits: ConvenioBenefit[];
  currentBenefitCode?: string;
};

const initialState: CuponActionState = { ok: false };

export function CuponValidationForm({
  registroId,
  provider,
  benefits,
  currentBenefitCode = "",
}: Props) {
  const [state, action, pending] = useActionState(asignarBeneficioConvenioAction, initialState);
  const available = useMemo(
    () => benefits.filter((benefit) => benefit.provider === provider),
    [benefits, provider]
  );
  const [benefitCode, setBenefitCode] = useState(currentBenefitCode);
  const selected = available.find((benefit) => benefit.code === benefitCode);

  return (
    <form action={action} className={styles.validationForm}>
      <input type="hidden" name="registro_id" value={registroId} />

      <label className={styles.benefitField}>
        <span>¿Qué beneficio compró el cliente?</span>
        <select
          name="beneficio_code"
          value={benefitCode}
          onChange={(event) => setBenefitCode(event.target.value)}
        >
          <option value="">Selecciona</option>
          {available.map((benefit) => (
            <option key={benefit.code} value={benefit.code}>
              {benefit.name}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className={styles.benefitPreview}>
          <strong>{selected.name}</strong>
          <span>{selected.duration} min{selected.sessions > 1 ? ` por sesión · ${selected.sessions} sesiones` : ""}</span>
          {selected.included && <p>{selected.included}</p>}
          {selected.restrictedBranch && <small>Solo aplica en {selected.restrictedBranch}.</small>}
        </div>
      )}

      <div className="formMessage">
        En esta fase solo se guarda el servicio correcto. No se calcula monto, comisión, fee ni cobertura.
      </div>

      {state.error && <div className="formMessage error" role="alert">{state.error}</div>}
      {state.ok && <div className="formMessage ok" role="status">{state.message}</div>}

      <button
        className="primaryButton"
        type="submit"
        disabled={pending || !benefitCode}
      >
        {pending ? "Guardando…" : "Guardar servicio"}
      </button>
    </form>
  );
}
