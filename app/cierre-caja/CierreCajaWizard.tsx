"use client";

import { useState, type FormEvent } from "react";
import { FormField } from "@/components/FormField";
import { Input } from "@/components/Input";
import { OperationalWizardStepper } from "@/components/OperationalWizardStepper";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { Textarea } from "@/components/Textarea";
import { calcularCajaFisica } from "@/lib/cierreCaja";
import {
  physicalValue,
  validateCierreStep,
  type CierreDraft,
} from "./cierreCajaDomain";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  fecha: string;
  sede: string;
  responsables: string[];
  totalIngresos: number;
  totalSalidas: number;
  efectivoRecibido: number;
  efectivoPropinas: number;
  pagosDigitales: number;
  pagosPorMetodo: Record<string, number>;
  paxTotal: number;
  boletasPendientes: number;
  totalSalidasEfectivo: number;
  salidasSinMetodo: number;
  cajaInicialSugerida: number;
  cierresExistentes: number;
  serverError?: string;
  errorStep?: number;
};

const steps = ["Datos", "Conteo", "Revisión", "Confirmar"];

function money(value: number | string) {
  const parsed = Number(String(value).replace(",", "."));
  const safe = Number.isFinite(parsed) ? parsed : 0;
  return `S/ ${safe.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function physicalMoney(value: number | null) {
  const physical = physicalValue(value);
  return typeof physical === "number" ? money(physical) : physical;
}

function numeric(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function CierreCajaWizard({
  action,
  fecha,
  sede,
  responsables,
  totalIngresos,
  totalSalidas,
  efectivoRecibido,
  efectivoPropinas,
  pagosDigitales,
  pagosPorMetodo,
  paxTotal,
  boletasPendientes,
  totalSalidasEfectivo,
  salidasSinMetodo,
  cajaInicialSugerida,
  cierresExistentes,
  serverError = "",
  errorStep = 1,
}: Props) {
  const initialStep = serverError ? Math.min(Math.max(errorStep, 1), 4) : 1;
  const [step, setStep] = useState(initialStep);
  const [maxStep, setMaxStep] = useState(initialStep);
  const [error, setError] = useState(serverError);
  const [responsable, setResponsable] = useState(
    responsables.includes("Gerald") ? "Gerald" : responsables[0] ?? "Gerald"
  );
  const [cajaInicial, setCajaInicial] = useState(cajaInicialSugerida.toFixed(2));
  const [efectivoContado, setEfectivoContado] = useState("0.00");
  const [fondoSiguiente, setFondoSiguiente] = useState(
    cajaInicialSugerida.toFixed(2)
  );
  const [observacion, setObservacion] = useState("");

  const fisicoCalculable = salidasSinMetodo === 0;
  const cierreBloqueado = cierresExistentes > 0;

  const draft: CierreDraft = {
    fecha,
    sede,
    responsable,
    cajaInicial,
    efectivoContado,
    fondoSiguiente,
  };

  const fisico = calcularCajaFisica({
    cajaInicial: numeric(cajaInicial),
    efectivoVitaLima: efectivoRecibido,
    efectivoPropinas,
    totalSalidasEfectivo,
    efectivoContado: numeric(efectivoContado),
    fondoSiguiente: numeric(fondoSiguiente),
    calculable: fisicoCalculable,
  });

  function goTo(target: number) {
    if (target > maxStep) return;
    if (target > step) {
      const message = validateCierreStep(step, draft);
      if (message) {
        setError(message);
        return;
      }
    }
    setError("");
    setStep(target);
  }

  function next() {
    const message = validateCierreStep(step, draft);
    if (message) {
      setError(message);
      return;
    }

    const target = Math.min(step + 1, 4);
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
    if (step < 4) {
      event.preventDefault();
      next();
      return;
    }

    if (cierreBloqueado || !fisicoCalculable) {
      event.preventDefault();
      setError(
        cierreBloqueado
          ? "Ya existe un cierre CERRADO para esta fecha y sede."
          : "Clasifica las salidas sin método antes de cerrar la caja."
      );
      return;
    }

    for (const currentStep of [1, 2]) {
      const message = validateCierreStep(currentStep, draft);
      if (message) {
        event.preventDefault();
        setStep(currentStep);
        setError(message);
        return;
      }
    }
  }

  const financialSummary = (
    <div className="operationalReview operationalFinancialReview">
      <div className="reviewImportant"><span>Ingresos Vita Lima</span><strong>{money(totalIngresos)}</strong></div>
      <div><span>Gastos Vita Lima</span><strong>{money(totalSalidas)}</strong></div>
      <div><span>Efectivo Vita Lima</span><strong>{money(efectivoRecibido)}</strong></div>
      <div><span>Propinas en efectivo</span><strong>{money(efectivoPropinas)}</strong></div>
      <div><span>Salidas que reducen efectivo</span><strong>{money(totalSalidasEfectivo)}</strong></div>
      <div><span>Pagos digitales Vita Lima</span><strong>{money(pagosDigitales)}</strong></div>
      {Object.entries(pagosPorMetodo).map(([metodo, monto]) => (
        <div key={metodo}><span>{metodo}</span><strong>{money(monto)}</strong></div>
      ))}
      <div><span>Pax</span><strong>{paxTotal}</strong></div>
      <div className={boletasPendientes > 0 ? "reviewPending" : ""}><span>Boletas pendientes</span><strong>{boletasPendientes}</strong></div>
      <div className={salidasSinMetodo > 0 ? "reviewPending" : ""}><span>Salidas sin método</span><strong>{salidasSinMetodo}</strong></div>
      <div><span>Caja física esperada</span><strong>{physicalMoney(fisico.cajaEsperada)}</strong></div>
      <div><span>Diferencia física</span><strong>{physicalMoney(fisico.diferencia)}</strong></div>
      <div><span>Efectivo a retirar/depositar</span><strong>{physicalMoney(fisico.efectivoARetirar)}</strong></div>
    </div>
  );

  return (
    <form action={action} className="formShell operationalWizard cierreWizard" onSubmit={handleSubmit}>
      <OperationalWizardStepper labels={steps} step={step} maxStep={maxStep} onNavigate={goTo} ariaLabel={`Cierre de caja: paso ${step} de 4`} />

      <section className={`wizardPanel ${step === 1 ? "visible" : ""}`} aria-labelledby="cierre-step-1">
        <p className="stepKicker">Paso 1 de 4</p>
        <h2 id="cierre-step-1">Datos del cierre</h2>
        <p className="wizardIntro">Confirma la fecha, sede y persona responsable.</p>
        {step === 1 && error && <div className="wizardError" role="alert">{error}</div>}

        {cierreBloqueado && (
          <div className="operationalWarning" role="status">
            Ya existe {cierresExistentes} cierre CERRADO para esta fecha y sede. No se permitirá crear otro cierre duplicado.
          </div>
        )}

        <div className="formGrid operationalWizardGrid">
          <FormField label="Fecha">
            <Input name="fecha" type="date" value={fecha} readOnly />
          </FormField>
          <FormField label="Sede">
            <Select value={sede} disabled aria-label="Sede del cierre">
              <option value={sede}>{sede}</option>
            </Select>
            <input type="hidden" name="sede" value={sede} />
          </FormField>
          <FormField label="Responsable">
            <Select name="responsable" value={responsable} onChange={(event) => setResponsable(event.target.value)}>
              {responsables.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </FormField>
          <FormField label="Estado">
            <Input value="CERRADO" readOnly />
          </FormField>
        </div>
        <p className="operationalHint">Para cambiar fecha o sede, usa los filtros de consulta superiores.</p>
      </section>

      <section className={`wizardPanel ${step === 2 ? "visible" : ""}`} aria-labelledby="cierre-step-2">
        <p className="stepKicker">Paso 2 de 4</p>
        <h2 id="cierre-step-2">Conteo físico</h2>
        <p className="wizardIntro">
          Cuenta el efectivo real de la sede. El fondo sugerido viene del último cierre de esta sede.
        </p>
        {step === 2 && error && <div className="wizardError" role="alert">{error}</div>}

        <div className="formGrid operationalWizardGrid">
          <FormField label="Caja inicial">
            <Input name="caja_inicial" type="number" inputMode="decimal" step="0.01" min="0" value={cajaInicial} onChange={(event) => setCajaInicial(event.target.value)} required />
          </FormField>
          <FormField label="Efectivo contado">
            <Input name="efectivo_contado" type="number" inputMode="decimal" step="0.01" min="0" value={efectivoContado} onChange={(event) => setEfectivoContado(event.target.value)} required />
          </FormField>
          <FormField label="Fondo para el siguiente día">
            <Input name="pozo_fondo" type="number" inputMode="decimal" step="0.01" min="0" value={fondoSiguiente} onChange={(event) => setFondoSiguiente(event.target.value)} required />
          </FormField>
        </div>

        <p className="operationalHint">
          Si dejas S/ 100 como fondo, el sistema calculará cuánto efectivo queda disponible para retirar o depositar.
        </p>
      </section>

      <section className={`wizardPanel ${step === 3 ? "visible" : ""}`} aria-labelledby="cierre-step-3">
        <p className="stepKicker">Paso 3 de 4</p>
        <h2 id="cierre-step-3">Revisión financiera</h2>
        <p className="wizardIntro">Resumen calculado desde los registros existentes.</p>

        {salidasSinMetodo > 0 && (
          <div className="operationalWarning" role="alert">
            Hay {salidasSinMetodo} salida{salidasSinMetodo === 1 ? "" : "s"} sin método. La caja física queda como “No calculable” hasta clasificarlas.
          </div>
        )}

        {financialSummary}
      </section>

      <section className={`wizardPanel ${step === 4 ? "visible" : ""}`} aria-labelledby="cierre-step-4">
        <p className="stepKicker">Paso 4 de 4</p>
        <h2 id="cierre-step-4">Confirmación</h2>
        <div className="operationalWarning" role="note">Revisa los datos antes de cerrar la caja.</div>
        {step === 4 && error && <div className="wizardError" role="alert">{error}</div>}

        <div className="operationalReview">
          <div><span>Fecha</span><strong>{fecha}</strong></div>
          <div><span>Sede</span><strong>{sede}</strong></div>
          <div><span>Responsable</span><strong>{responsable}</strong></div>
          <div><span>Caja inicial</span><strong>{money(cajaInicial)}</strong></div>
          <div><span>Efectivo contado</span><strong>{money(efectivoContado)}</strong></div>
          <div><span>Fondo siguiente día</span><strong>{money(fondoSiguiente)}</strong></div>
        </div>

        {financialSummary}

        <div className="operationalObservation">
          <FormField label="Observación opcional">
            <Textarea name="observacion" value={observacion} onChange={(event) => setObservacion(event.target.value)} rows={3} placeholder="Ej. Faltante explicado, sobrante, efectivo entregado a Naty, etc." />
          </FormField>
        </div>
      </section>

      <div className="wizardActions operationalWizardActions">
        {step > 1 ? <button type="button" className="ghostButton" onClick={previous}>Atrás</button> : <span />}
        {step < 3 && <button type="button" className="primaryButton" onClick={next}>Continuar</button>}
        {step === 3 && <button type="button" className="primaryButton" onClick={next}>Revisar cierre</button>}
        {step === 4 && (
          <SubmitButton
            className="primaryButton"
            pendingLabel="Cerrando caja…"
            disabled={cierreBloqueado || !fisicoCalculable}
          >
            Cerrar caja
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
