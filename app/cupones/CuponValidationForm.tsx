"use client";

import { useActionState, useState } from "react";
import { ServicePicker } from "@/app/preparar-cita/components/ServicePicker";
import type { Service } from "@/app/preparar-cita/components/types";
import { validarCuponConvenioAction, type CuponActionState } from "./actions";
import styles from "./CuponesPage.module.css";

type Props = {
  registroId: string;
  services: Service[];
};

const initialState: CuponActionState = { ok: false };

export function CuponValidationForm({ registroId, services }: Props) {
  const [state, action, pending] = useActionState(validarCuponConvenioAction, initialState);
  const [serviceCode, setServiceCode] = useState("");
  const [monto, setMonto] = useState("");

  return (
    <form action={action} className={styles.validationForm}>
      <input type="hidden" name="registro_id" value={registroId} />
      <input type="hidden" name="service_code" value={serviceCode} />

      <ServicePicker
        services={services}
        value={serviceCode}
        label="¿Qué servicio compró el cliente?"
        onChange={setServiceCode}
      />

      <label className={styles.amountField}>
        <span>Monto reconocido por el convenio</span>
        <input
          name="monto_reconocido"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={monto}
          onChange={(event) => setMonto(event.target.value)}
          placeholder="0.00"
        />
        <small>No es dinero recibido por Vita Lima. Es la cobertura que se conciliará al completar la atención.</small>
      </label>

      {state.error && <div className="formMessage error" role="alert">{state.error}</div>}
      {state.ok && <div className="formMessage ok" role="status">{state.message}</div>}

      <button
        className="primaryButton"
        type="submit"
        disabled={pending || !serviceCode || Number(monto) <= 0}
      >
        {pending ? "Validando…" : "Validar cupón y servicio"}
      </button>
    </form>
  );
}
