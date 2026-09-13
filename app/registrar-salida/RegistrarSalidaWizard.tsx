"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { OperationalWizardStepper } from "@/components/OperationalWizardStepper";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { Textarea } from "@/components/Textarea";
import { validateSalidaStep, type SalidaDraft } from "./registrarSalidaWizard";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  sedes: string[];
  tiposGasto: string[];
  responsables: string[];
  defaultDate: string;
  defaultTime: string;
  defaultSede: string;
  serverError?: string;
  errorStep?: number;
};

const steps = ["Operación", "Detalle", "Confirmar"];

function money(value: string) {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) return "S/ 0.00";
  return `S/ ${parsed.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function RegistrarSalidaWizard({
  action,
  sedes,
  tiposGasto,
  responsables,
  defaultDate,
  defaultTime,
  defaultSede,
  serverError = "",
  errorStep = 1,
}: Props) {
  const initialStep = serverError ? Math.min(Math.max(errorStep, 1), 3) : 1;
  const [step, setStep] = useState(initialStep);
  const [maxStep, setMaxStep] = useState(initialStep);
  const [error, setError] = useState(serverError);
  const [fecha, setFecha] = useState(defaultDate);
  const [hora, setHora] = useState(defaultTime);
  const [sede, setSede] = useState(defaultSede);
  const [tipoGasto, setTipoGasto] = useState(tiposGasto[0] ?? "");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [responsable, setResponsable] = useState(
    responsables.includes("Gerald") ? "Gerald" : responsables[0] ?? "Gerald"
  );
  const [sourceMovimientoId, setSourceMovimientoId] = useState("");
  const [observacion, setObservacion] = useState("");

  const draft: SalidaDraft = {
    fecha,
    hora,
    sede,
    tipoGasto,
    concepto,
    monto,
    responsable,
  };

  function goTo(target: number) {
    if (target > maxStep) return;
    if (target > step) {
      const message = validateSalidaStep(step, draft);
      if (message) {
        setError(message);
        return;
      }
    }
    setError("");
    setStep(target);
  }

  function next() {
    const message = validateSalidaStep(step, draft);
    if (message) {
      setError(message);
      return;
    }

    const target = Math.min(step + 1, 3);
    setError("");
    setMaxStep((current) => Math.max(current, target));
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previous() {
    setError("");
    setStep((current) => Math.max(current - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (step < 3) {
      event.preventDefault();
      next();
      return;
    }

    for (const currentStep of [1, 2]) {
      const message = validateSalidaStep(currentStep, draft);
      if (message) {
        event.preventDefault();
        setStep(currentStep);
        setError(message);
        return;
      }
    }
  }

  return (
    <form action={action} className="formShell operationalWizard" onSubmit={handleSubmit}>
      <OperationalWizardStepper
        labels={steps}
        step={step}
        maxStep={maxStep}
        onNavigate={goTo}
        ariaLabel={`Registro de salida: paso ${step} de 3`}
      />

      <section className={`wizardPanel ${step === 1 ? "visible" : ""}`} aria-labelledby="salida-step-1">
        <p className="stepKicker">Paso 1 de 3</p>
        <h2 id="salida-step-1">Operación</h2>
        <p className="wizardIntro">Define cuándo, dónde y qué tipo de salida registrarás.</p>
        {step === 1 && error && <div className="wizardError" role="alert">{error}</div>}

        <div className="formGrid operationalWizardGrid">
          <FormField label="Fecha">
            <Input name="fecha" type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} required />
          </FormField>
          <FormField label="Hora">
            <Input name="hora" type="time" value={hora} onChange={(event) => setHora(event.target.value)} required />
          </FormField>
          <FormField label="Sede">
            <Select name="sede" value={sede} onChange={(event) => setSede(event.target.value)} required>
              {sedes.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </FormField>
          <FormField label="Tipo de gasto">
            <Select name="tipo_gasto" value={tipoGasto} onChange={(event) => setTipoGasto(event.target.value)} required>
              {tiposGasto.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </FormField>
        </div>
      </section>

      <section className={`wizardPanel ${step === 2 ? "visible" : ""}`} aria-labelledby="salida-step-2">
        <p className="stepKicker">Paso 2 de 3</p>
        <h2 id="salida-step-2">Detalle</h2>
        <p className="wizardIntro">Completa el concepto, monto y responsable.</p>
        {step === 2 && error && <div className="wizardError" role="alert">{error}</div>}

        <div className="formGrid operationalWizardGrid">
          <FormField label="Concepto">
            <Input name="concepto" value={concepto} onChange={(event) => setConcepto(event.target.value)} placeholder="Ej. Compra de aceite, movilidad, limpieza, etc." required />
          </FormField>
          <FormField label="Monto">
            <Input name="monto" type="number" inputMode="decimal" step="0.01" min="0" value={monto} onChange={(event) => setMonto(event.target.value)} placeholder="0.00" required />
          </FormField>
          <FormField label="Responsable">
            <Select name="responsable" value={responsable} onChange={(event) => setResponsable(event.target.value)}>
              {responsables.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </FormField>
        </div>

        <details className="operationalAdvanced">
          <summary>Opciones avanzadas</summary>
          <div className="operationalAdvancedBody">
            <FormField label="Movimiento relacionado">
              <Input name="source_movimiento_id" value={sourceMovimientoId} onChange={(event) => setSourceMovimientoId(event.target.value)} placeholder="Opcional. Ej. MOV-APP-..." />
            </FormField>
          </div>
        </details>
      </section>

      <section className={`wizardPanel ${step === 3 ? "visible" : ""}`} aria-labelledby="salida-step-3">
        <p className="stepKicker">Paso 3 de 3</p>
        <h2 id="salida-step-3">Confirmar</h2>
        <p className="wizardIntro">Revisa la salida antes de guardarla.</p>
        {step === 3 && error && <div className="wizardError" role="alert">{error}</div>}

        <div className="operationalReview">
          <div><span>Fecha y hora</span><strong>{fecha} · {hora}</strong></div>
          <div><span>Sede</span><strong>{sede}</strong></div>
          <div><span>Tipo</span><strong>{tipoGasto}</strong></div>
          <div className="reviewWide"><span>Concepto</span><strong>{concepto || "—"}</strong></div>
          <div className="reviewNeutral"><span>Monto</span><strong>{money(monto)}</strong></div>
          <div><span>Responsable</span><strong>{responsable}</strong></div>
          {sourceMovimientoId && <div className="reviewWide"><span>Movimiento relacionado</span><strong>{sourceMovimientoId}</strong></div>}
        </div>

        <div className="operationalObservation">
          <FormField label="Observación opcional">
            <Textarea name="observacion" value={observacion} onChange={(event) => setObservacion(event.target.value)} rows={3} placeholder="Ej. Gasto real, comprobante pendiente, diferencia explicada, etc." />
          </FormField>
        </div>
      </section>

      <div className="wizardActions operationalWizardActions">
        {step === 1 ? (
          <Link className="ghostButton" href="/citas-hoy">Volver a citas</Link>
        ) : (
          <button type="button" className="ghostButton" onClick={previous}>Atrás</button>
        )}

        {step < 3 ? (
          <button type="button" className="primaryButton" onClick={next}>Continuar</button>
        ) : (
          <SubmitButton className="primaryButton" pendingLabel="Guardando salida…">Guardar salida</SubmitButton>
        )}
      </div>
    </form>
  );
}
