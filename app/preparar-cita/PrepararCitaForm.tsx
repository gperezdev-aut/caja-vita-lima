"use client";

import { useActionState, useMemo, useState } from "react";
import {
  calcularCitaDomicilio,
  calcularAdelantoRequerido,
  esCodigoDomicilio,
} from "@/lib/fichaCitaDominio";
import {
  buscarClienteFichaAction,
  prepararCitaAction,
  type PrepararCitaState,
} from "./actions";

type Service = {
  code: string;
  name: string;
  duration: number;
  price: number;
  paxType: string;
  sortOrder: number;
};

type Props = {
  services: Service[];
  sedes: { name: string; open: string; close: string }[];
  metodos: string[];
  countries: { code: string; name: string; callingCode: string }[];
  requestId: string;
  minDate: string;
};

const initialState: PrepararCitaState = { ok: false };

function money(value: number) {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(value);
}

function toMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function PrepararCitaForm({ services, sedes, metodos, countries, requestId, minDate }: Props) {
  const [state, formAction, pending] = useActionState(prepararCitaAction, initialState);
  const [personas, setPersonas] = useState<1 | 2>(1);
  const [sede, setSede] = useState(sedes[0]?.name ?? "");
  const [fecha, setFecha] = useState(minDate);
  const [hora, setHora] = useState("");
  const [pais, setPais] = useState("PE");
  const [telefono, setTelefono] = useState("");
  const [cliente, setCliente] = useState("");
  const [service1, setService1] = useState("");
  const [service2, setService2] = useState("");
  const [paid, setPaid] = useState(0);
  const [lookupMessage, setLookupMessage] = useState("");

  const eligibleServices = useMemo(() => {
    const onePerson = services.filter((item) => item.paxType === "1p");
    const withDomicilio = services.filter((item) => esCodigoDomicilio(item.code));
    return Array.from(new Map([...onePerson, ...withDomicilio].map((item) => [item.code, item])).values());
  }, [services]);
  const selected = [
    eligibleServices.find((item) => item.code === service1),
    personas === 2 ? eligibleServices.find((item) => item.code === service2) : null,
  ].filter((item): item is Service => Boolean(item));
  const esDomicilio = selected.length > 0 && selected.every((item) => esCodigoDomicilio(item.code));
  const opcionesServicio2 = service1
    ? eligibleServices.filter((item) => esCodigoDomicilio(item.code) === esCodigoDomicilio(service1))
    : eligibleServices;
  const economiaDomicilio = esDomicilio
    ? calcularCitaDomicilio(selected.map((item) => ({ codigo: item.code, precio: item.price, duracion_min: item.duration })))
    : null;
  const subtotalServicios = selected.reduce((sum, item) => sum + item.price, 0);
  const movilidad = economiaDomicilio?.ok ? economiaDomicilio.movilidad : 0;
  const total = economiaDomicilio?.ok ? economiaDomicilio.total : subtotalServicios;
  const required = calcularAdelantoRequerido({
    canal: "directo",
    personas,
    montoTotal: total,
    esDomicilio,
  });
  const selectedSede = sedes.find((item) => item.name === sede);
  const duration = Math.max(0, ...selected.map((item) => item.duration));
  const hours = useMemo(() => {
    if (!selectedSede || duration <= 0) return [];
    const result: string[] = [];
    for (
      let minute = toMinutes(selectedSede.open);
      minute + duration <= toMinutes(selectedSede.close);
      minute += 30
    ) {
      result.push(fromMinutes(minute));
    }
    return result;
  }, [selectedSede, duration]);

  async function lookupClient() {
    setLookupMessage("Buscando…");
    const result = await buscarClienteFichaAction(telefono, pais);
    if (result.cliente) {
      setCliente(result.cliente);
      setLookupMessage("Cliente localizado.");
    } else {
      setLookupMessage(result.error || "No existe; se creará al guardar.");
    }
  }

  async function copyMessage() {
    if (state.mensaje) await navigator.clipboard.writeText(state.mensaje);
  }

  if (state.ok) {
    return (
      <section className="atencionForm fichaSuccess" aria-live="polite">
        <p className="eyebrow">Cita y pago guardados</p>
        <h2>Enlace listo</h2>
        <p>{state.mensaje}</p>
        <button type="button" className="primaryButton copyMessageButton" onClick={copyMessage}>
          Copiar mensaje
        </button>
      </section>
    );
  }

  return (
    <form action={formAction} className="atencionForm fichaPrepararForm">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="canal" value="directo" />
      <input type="hidden" name="tipo_atencion" value={esDomicilio ? "domicilio" : "sede"} />
      {state.error && <div className="formMessage error" role="alert">{state.error}</div>}

      <section className="wizardPanel visible">
        <h2>1. Origen y cliente</h2>
        <p className="wizardIntro">
          Este nuevo flujo admite por ahora citas directas presenciales y a domicilio. Cuponidad, Bee Beneficios,
          promociones y gift cards continúan registrándose mediante el proceso actual.
        </p>
        <div className="atencionGrid">
          <div className="atencionField"><span>Canal</span><strong>Directo</strong></div>
          <label className="atencionField">
            País del teléfono
            <select name="pais" value={pais} onChange={(event) => setPais(event.target.value)}>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>{country.name} (+{country.callingCode})</option>
              ))}
            </select>
          </label>
          <label className="atencionField">
            WhatsApp
            <input name="telefono" value={telefono} onChange={(event) => setTelefono(event.target.value)} placeholder="987 654 321 o +…" required />
          </label>
          <div className="atencionField lookupField">
            <span>Cliente existente</span>
            <button type="button" className="ghostButton" onClick={lookupClient}>Buscar</button>
            <small>{lookupMessage}</small>
          </div>
          <label className="atencionField atencionFieldWide">
            Nombre del cliente
            <input name="cliente" value={cliente} onChange={(event) => setCliente(event.target.value)} required />
          </label>
          <label className="atencionField">
            Idioma
            <select name="idioma" defaultValue="es"><option value="es">Español</option><option value="en">English</option></select>
          </label>
        </div>
      </section>

      <section className="wizardPanel visible">
        <h2>2. Servicios</h2>
        <div className="atencionGrid">
          <label className="atencionField">
            Personas
            <select name="personas" value={personas} onChange={(event) => { setPersonas(Number(event.target.value) as 1 | 2); setHora(""); }}>
              <option value="1">1 persona</option><option value="2">2 personas</option>
            </select>
          </label>
          <label className="atencionField">
            Servicio — persona 1
            <select name="servicio_1" value={service1} onChange={(event) => { setService1(event.target.value); setService2(""); setHora(""); }} required>
              <option value="">Selecciona</option>
              {eligibleServices.map((item) => <option key={item.code} value={item.code}>{item.name} · {money(item.price)}</option>)}
            </select>
          </label>
          {personas === 2 && (
            <label className="atencionField">
              Servicio — persona 2
              <select name="servicio_2" value={service2} onChange={(event) => { setService2(event.target.value); setHora(""); }} required>
                <option value="">Selecciona</option>
                {opcionesServicio2.map((item) => <option key={item.code} value={item.code}>{item.name} · {money(item.price)}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="wizardPanel visible">
        <h2>3. {esDomicilio ? "Domicilio, fecha y hora" : "Sede, fecha y hora"}</h2>
        <div className="atencionGrid">
          <label className="atencionField">
            {esDomicilio ? "Sede operativa" : "Sede"}
            <select name="sede" value={sede} onChange={(event) => { setSede(event.target.value); setHora(""); }} required>
              {sedes.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.open}–{item.close}</option>)}
            </select>
          </label>
          {esDomicilio && (
            <>
              <label className="atencionField">
                Distrito
                <input name="domicilio_distrito" required />
              </label>
              <label className="atencionField atencionFieldWide">
                Dirección
                <input name="domicilio_direccion" required />
              </label>
              <label className="atencionField atencionFieldWide">
                Referencia (opcional)
                <input name="domicilio_referencia" />
              </label>
            </>
          )}
          <label className="atencionField">
            Fecha
            <input name="fecha" type="date" min={minDate} value={fecha} onChange={(event) => setFecha(event.target.value)} required />
          </label>
          <div className="atencionField atencionFieldWide">
            <span>Hora (la duración completa debe caber)</span>
            <div className="timeChips">
              {hours.map((value) => (
                <button key={value} type="button" className={hora === value ? "active" : ""} onClick={() => setHora(value)}>{value}</button>
              ))}
              {!hours.length && <small>Selecciona todos los servicios para ver horas disponibles.</small>}
            </div>
            <input type="hidden" name="hora" value={hora} />
          </div>
        </div>
      </section>

      <section className="wizardPanel visible">
        <h2>4. Pago y envío</h2>
        <div className="paymentSummary">
          <div><span>Servicios</span><strong>{money(subtotalServicios)}</strong></div>
          {esDomicilio && <div><span>Movilidad</span><strong>{money(movilidad)}</strong></div>}
          <div><span>Total calculado</span><strong>{money(total)}</strong></div>
          <div><span>Adelanto requerido</span><strong>{money(required)}</strong></div>
          <div><span>Saldo pendiente</span><strong>{money(Math.max(total - paid, 0))}</strong></div>
          <div><span>Confirmación manual</span><strong>{esDomicilio ? "Sí" : "No"}</strong></div>
        </div>
        <div className="atencionGrid paymentFields">
          <label className="atencionField">Monto recibido<input name="monto_pagado" type="number" min="0" step="0.01" value={paid} onChange={(event) => setPaid(Number(event.target.value || 0))} required /></label>
          <label className="atencionField">Método<select name="metodo_pago" disabled={paid <= 0} defaultValue=""><option value="">{paid > 0 ? "Selecciona" : "Convenio / sin adelanto"}</option>{metodos.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="atencionField">Número de operación<input name="numero_operacion" disabled={paid <= 0} /></label>
          <label className="atencionField atencionFieldWide">Observación<textarea name="observacion" rows={2} /></label>
        </div>
        <button type="submit" className="primaryButton saveFichaButton" disabled={pending || !hora || total <= 0 || paid < required || (esDomicilio && !economiaDomicilio?.ok)}>
          {pending ? "Guardando transacción…" : "Guardar cita, pago y generar enlace"}
        </button>
      </section>
    </form>
  );
}
