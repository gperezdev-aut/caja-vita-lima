"use client";

import { useActionState, useMemo, useState } from "react";
import { prepararConvenioAction, type PrepararCitaState } from "./actions";
import { compactPhoneInput, formatDate, formatTime } from "./prepararCitaWizard";

type Props = {
  sedes: { name: string; open: string; close: string }[];
  countries: { code: string; name: string; callingCode: string }[];
  requestId: string;
  minDate: string;
  onBack: () => void;
};

const initialState: PrepararCitaState = { ok: false };

function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function fromMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function providerLabel(value: string) {
  return value === "cuponidad" ? "Cuponidad" : value === "bee" ? "Bee Beneficios" : "";
}

export function PrepararConvenioForm({ sedes, countries, requestId, minDate, onBack }: Props) {
  const [state, formAction, pending] = useActionState(prepararConvenioAction, initialState);
  const [step, setStep] = useState(0);
  const [canal, setCanal] = useState<"cuponidad" | "bee" | "">("");
  const [pais, setPais] = useState("PE");
  const [telefono, setTelefono] = useState("");
  const [sede, setSede] = useState(sedes[0]?.name ?? "");
  const [fecha, setFecha] = useState(minDate);
  const [hora, setHora] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const selectedSede = sedes.find((item) => item.name === sede);
  const selectedCallingCode = countries.find((country) => country.code === pais)?.callingCode ?? "";
  const hours = useMemo(() => {
    if (!selectedSede) return [];
    const result: string[] = [];
    for (let minute = toMinutes(selectedSede.open); minute + 30 <= toMinutes(selectedSede.close); minute += 30) {
      result.push(fromMinutes(minute));
    }
    return result;
  }, [selectedSede]);

  function next() {
    if (step === 0 && (!canal || !telefono.trim())) {
      setError(!canal ? "Selecciona Cuponidad o Bee Beneficios." : "Ingresa el WhatsApp del cliente.");
      return;
    }
    if (step === 1 && (!sede || !fecha || !hora)) {
      setError("Selecciona sede, fecha y hora.");
      return;
    }
    setError("");
    setStep((current) => Math.min(current + 1, 2));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyLink() {
    if (!state.enlace) return;
    await navigator.clipboard.writeText(state.enlace);
    setCopied(true);
  }

  if (state.ok) {
    return (
      <section className="atencionForm fichaSuccess" aria-live="polite">
        <span className="successMark" aria-hidden="true">✓</span>
        <p className="eyebrow">Cupón / Beneficio</p>
        <h2>Enlace de ficha listo</h2>
        <p className="successMessage">{state.mensaje}</p>
        <div className="successActions">
          <button type="button" className="primaryButton" onClick={copyLink}>
            {copied ? "Enlace copiado" : "Copiar enlace"}
          </button>
          {state.whatsappUrl && (
            <a className="ghostButton" href={state.whatsappUrl} target="_blank" rel="noreferrer">
              Abrir WhatsApp
            </a>
          )}
          <a className="ghostButton" href={state.enlace} target="_blank" rel="noreferrer">
            Abrir ficha web
          </a>
          <a className="ghostButton" href="/preparar-cita">Nueva cita</a>
        </div>
      </section>
    );
  }

  return (
    <form action={formAction} className="atencionForm fichaPrepararForm prepararWizard" noValidate>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="canal" value={canal} />
      <input type="hidden" name="pais" value={pais} />
      <input type="hidden" name="telefono" value={telefono} />
      <input type="hidden" name="sede" value={sede} />
      <input type="hidden" name="fecha" value={fecha} />
      <input type="hidden" name="hora" value={hora} />

      <nav className="prepararStepper" aria-label="Progreso de cupón o beneficio">
        {["Proveedor", "Horario", "Confirmar"].map((label, index) => (
          <button
            key={label}
            type="button"
            className={index === step ? "active" : index < step ? "done" : ""}
            disabled={index > step}
            onClick={() => index <= step && setStep(index)}
          >
            <span aria-hidden="true">{index < step ? "✓" : index + 1}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>

      {(state.error || error) && <div className="formMessage error" role="alert">{state.error || error}</div>}

      {step === 0 && (
        <section className="wizardPanel visible prepararStepPanel">
          <p className="stepKicker">Paso 1 de 3</p>
          <h2>Proveedor y WhatsApp</h2>
          <p className="wizardIntro">
            Registra el WhatsApp una sola vez. El cliente no tendrá que volver a escribirlo en la ficha web.
          </p>
          <div className="appointmentTypeGrid" role="radiogroup" aria-label="Proveedor del beneficio">
            {[
              { value: "cuponidad", label: "Cuponidad" },
              { value: "bee", label: "Bee Beneficios" },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={canal === item.value}
                className={canal === item.value ? "selected" : ""}
                onClick={() => {
                  setCanal(item.value as "cuponidad" | "bee");
                  setError("");
                }}
              >
                <strong>{item.label}</strong>
                <span>El código lo completa el cliente en la página web.</span>
              </button>
            ))}
          </div>

          <div className="clientLookupRow" style={{ marginTop: 18 }}>
            <label className="atencionField countryField">
              País
              <select value={pais} onChange={(event) => setPais(event.target.value)} aria-label="País del teléfono">
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name} (+{country.callingCode})
                  </option>
                ))}
              </select>
            </label>
            <label className="atencionField phoneField">
              WhatsApp
              <input
                value={telefono}
                inputMode="tel"
                autoComplete="tel"
                onChange={(event) => { setTelefono(event.target.value); setError(""); }}
                onBlur={() => setTelefono((current) => compactPhoneInput(current))}
                placeholder="987 654 321"
              />
              <small>Prefijo seleccionado: +{selectedCallingCode}. También puedes pegar el número completo.</small>
            </label>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="wizardPanel visible prepararStepPanel">
          <p className="stepKicker">Paso 2 de 3 · {providerLabel(canal)}</p>
          <h2>Agenda la cita</h2>
          <p className="wizardIntro">
            Selecciona sede, fecha y hora. El cliente completará nombre, código y salud desde la ficha.
          </p>
          <div className="clientDetailsGrid">
            <label className="atencionField">
              Sede
              <select value={sede} onChange={(event) => { setSede(event.target.value); setHora(""); }}>
                {sedes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            <label className="atencionField">
              Fecha
              <input type="date" min={minDate} value={fecha} onChange={(event) => setFecha(event.target.value)} />
            </label>
            <label className="atencionField">
              Hora
              <select value={hora} onChange={(event) => setHora(event.target.value)}>
                <option value="">Selecciona una hora</option>
                {hours.map((value) => <option key={value} value={value}>{formatTime(value)}</option>)}
              </select>
            </label>
          </div>
          <p className="fieldMessage">
            El horario queda reservado de forma preliminar. La duración final se confirma al validar el servicio comprado.
          </p>
        </section>
      )}

      {step === 2 && (
        <section className="wizardPanel visible prepararStepPanel">
          <p className="stepKicker">Paso 3 de 3</p>
          <h2>Confirma la reserva</h2>
          <div className="convenioConfirmationGrid">
            <div><span>Tipo</span><strong>Cupón / Beneficio</strong></div>
            <div><span>Proveedor</span><strong>{providerLabel(canal)}</strong></div>
            <div><span>WhatsApp</span><strong>{telefono || "—"}</strong></div>
            <div><span>Sede</span><strong>{sede}</strong></div>
            <div><span>Fecha</span><strong>{formatDate(fecha)}</strong></div>
            <div><span>Hora</span><strong>{formatTime(hora)}</strong></div>
            <div><span>Pago en Caja</span><strong>No corresponde</strong></div>
          </div>
          <div className="formMessage" style={{ marginTop: 16 }}>
            Caja ya registró el WhatsApp. El cliente completa nombre, salud y código en la ficha pública de Vita Lima.
          </div>
        </section>
      )}

      <div className="wizardActions">
        {step === 0
          ? <button type="button" className="ghostButton" onClick={onBack}>Cambiar tipo de cita</button>
          : <button type="button" className="ghostButton" onClick={() => { setError(""); setStep((current) => Math.max(current - 1, 0)); }}>Atrás</button>}
        {step < 2
          ? <button type="button" className="primaryButton" onClick={next}>Continuar</button>
          : <button type="submit" className="primaryButton" disabled={pending}>{pending ? "Generando…" : "Generar enlace de ficha"}</button>}
      </div>
    </form>
  );
}
