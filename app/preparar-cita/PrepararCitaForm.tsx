"use client";

import { useActionState, useMemo, useState } from "react";
import {
  calcularAdelantoRequerido,
  calcularAtencionPersonalizada,
} from "@/lib/fichaCitaDominio";
import {
  calcularEconomiaHome,
  servicioEsCitaNormal,
  servicioEsComponente,
  servicioEsHome,
  type PoliticaHome,
} from "@/lib/catalogoPrepararCitaDominio";
import {
  buscarClienteFichaAction,
  prepararCitaAction,
  type PrepararCitaState,
} from "./actions";
import type { PersonaPersonalizada } from "@/lib/fichaCitaDominio";

type Service = {
  code: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  modality: string;
  peopleMin: number;
  peopleMax: number;
  selectionRule: string;
  reservationBehavior: string;
};

type Props = {
  services: Service[];
  homePolicies: PoliticaHome[];
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

function domainService(service: Service) {
  return {
    pricePen: service.price, category: service.category, modality: service.modality,
    selectionRule: service.selectionRule, reservationBehavior: service.reservationBehavior,
  };
}

export function PrepararCitaForm({ services, homePolicies, sedes, metodos, countries, requestId, minDate }: Props) {
  const [state, formAction, pending] = useActionState(prepararCitaAction, initialState);
  const [personas, setPersonas] = useState(1);
  const [personalizada, setPersonalizada] = useState(false);
  const [modalidad, setModalidad] = useState<"simultanea" | "consecutiva">("simultanea");
  const [componentes, setComponentes] = useState<PersonaPersonalizada[]>([
    { persona: 1, componentes: [] },
  ]);
  const [precioFinal, setPrecioFinal] = useState("");
  const [sede, setSede] = useState(sedes[0]?.name ?? "");
  const [fecha, setFecha] = useState(minDate);
  const [hora, setHora] = useState("");
  const [pais, setPais] = useState("PE");
  const [telefono, setTelefono] = useState("");
  const [cliente, setCliente] = useState("");
  const [service1, setService1] = useState("");
  const [service2, setService2] = useState("");
  const [paid, setPaid] = useState(0);
  const [district, setDistrict] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");

  const eligibleServices = useMemo(() => {
    return services.filter((item) => servicioEsCitaNormal(domainService(item)) && (
      personas === 1
        ? item.selectionRule === "ONE_PERSON" || item.selectionRule === "HOME_FLOW"
        : ["ONE_PERSON", "FIXED_TWO_PACKAGE", "HOME_FLOW"].includes(item.selectionRule)
    ));
  }, [personas, services]);
  const first = eligibleServices.find((item) => item.code === service1);
  const seleccionUnica = personas === 2 && first?.selectionRule === "FIXED_TWO_PACKAGE";
  const selected = [
    eligibleServices.find((item) => item.code === service1),
    personas === 2 && !seleccionUnica ? eligibleServices.find((item) => item.code === service2) : null,
  ].filter((item): item is Service => Boolean(item));
  const esDomicilio = !personalizada && selected.length > 0 && selected.every((item) => servicioEsHome(domainService(item)));
  const personalizadaCalculada = personalizada ? calcularAtencionPersonalizada({ personas, modalidad, componentes, precioFinal: precioFinal ? Number(precioFinal) : null, motivoAjuste: "UI exige campo", confirmaDisponibilidad: true }) : null;
  const opcionesServicio2 = service1
    ? eligibleServices.filter((item) => item.selectionRule === first?.selectionRule && item.selectionRule !== "FIXED_TWO_PACKAGE")
    : eligibleServices;
  const economiaDomicilio = esDomicilio
    ? calcularEconomiaHome(selected.map(domainService), district, homePolicies)
    : null;
  const subtotalServicios = personalizadaCalculada?.ok ? personalizadaCalculada.precioCalculado : selected.reduce((sum, item) => sum + item.price, 0);
  const movilidad = economiaDomicilio?.ok ? economiaDomicilio.feePen : 0;
  const total = personalizadaCalculada?.ok ? personalizadaCalculada.precioFinal : economiaDomicilio?.ok ? (economiaDomicilio.total ?? 0) : subtotalServicios;
  const required = calcularAdelantoRequerido({
    canal: "directo",
    personas,
    montoTotal: total,
    esDomicilio,
  });
  const selectedSede = sedes.find((item) => item.name === sede);
  const duration = personalizadaCalculada?.ok ? personalizadaCalculada.duracionMin : Math.max(0, ...selected.map((item) => item.duration));
  const hours = (() => {
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
  })();

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
      <input type="hidden" name="atencion_personalizada" value={personalizada ? "1" : "0"} />
      {personalizada && <><input type="hidden" name="componentes" value={JSON.stringify(componentes)} /><input type="hidden" name="modalidad" value={modalidad} /></>}
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
        <label className="fichaConsent"><input type="checkbox" checked={personalizada} onChange={(e) => { setPersonalizada(e.target.checked); setHora(""); }} /> Atención personalizada</label>
        <div className="atencionGrid">
          <label className="atencionField">
            Personas
            <select name="personas" value={personas} onChange={(event) => { const n=Number(event.target.value); setPersonas(n); setService1(""); setService2(""); setComponentes(Array.from({length:n},(_,i)=>componentes[i] ?? {persona:i+1,componentes:[]})); setHora(""); }}>
              {[1,2,3,4,5].filter((n)=>personalizada || n<=2).map((n)=><option key={n} value={n}>{n} persona{n>1?"s":""}</option>)}
            </select>
          </label>
          {personalizada && <><label className="atencionField">Modalidad<select value={modalidad} onChange={(e)=>{const valor=e.target.value; if (valor === "simultanea" || valor === "consecutiva") setModalidad(valor); setHora("");}}><option value="simultanea">Simultánea</option><option value="consecutiva">Consecutiva</option></select></label>
          {componentes.map((p, index)=><div className="atencionField atencionFieldWide" key={p.persona}><strong>Persona {p.persona}</strong>{p.componentes.map((c, ci)=><div key={ci} className="atencionGrid"><select value={c.tipo==="catalogo"?c.codigo:"manual"} onChange={(e)=>{const code=e.target.value;const next=structuredClone(componentes);next[index].componentes[ci]=code==="manual"?{tipo:"manual",nombre:"",duracion_min:0,precio:0}:{tipo:"catalogo",codigo:code,nombre:"",duracion_min:0,precio:0};setComponentes(next);}}><option value="manual">Manual</option>{services.filter(s=>servicioEsComponente(domainService(s))).map(s=><option key={s.code} value={s.code}>{s.name} · {money(s.price)} · {s.duration} min</option>)}</select>{c.tipo==="manual"&&<><input placeholder="Nombre" onChange={(e)=>{const n=structuredClone(componentes);n[index].componentes[ci].nombre=e.target.value;setComponentes(n);}}/><input type="number" placeholder="Minutos" onChange={(e)=>{const n=structuredClone(componentes);n[index].componentes[ci].duracion_min=Number(e.target.value);setComponentes(n);}}/><input type="number" placeholder="Precio" onChange={(e)=>{const n=structuredClone(componentes);n[index].componentes[ci].precio=Number(e.target.value);setComponentes(n);}}/></>}</div>)}<button type="button" onClick={()=>{const n=structuredClone(componentes);n[index].componentes.push({tipo:"catalogo",codigo:"",nombre:"",precio:0,duracion_min:0});setComponentes(n);}}>Añadir componente</button></div>)}</>}
          {!personalizada && <>
          <label className="atencionField">
            Servicio — persona 1
            <select name="servicio_1" value={service1} onChange={(event) => { setService1(event.target.value); setService2(""); setHora(""); }} required>
              <option value="">Selecciona</option>
              {eligibleServices.map((item) => <option key={item.code} value={item.code}>{item.name} · {money(item.price)} · {item.duration} min</option>)}
            </select>
          </label>
          {personas === 2 && !seleccionUnica && (
            <label className="atencionField">
              Servicio — persona 2
              <select name="servicio_2" value={service2} onChange={(event) => { setService2(event.target.value); setHora(""); }} required>
                <option value="">Selecciona</option>
                {opcionesServicio2.map((item) => <option key={item.code} value={item.code}>{item.name} · {money(item.price)} · {item.duration} min</option>)}
              </select>
            </label>
          )}
          </>}
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
                <input name="domicilio_distrito" value={district} onChange={(event) => setDistrict(event.target.value)} required />
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
          {esDomicilio && <div><span>Movilidad</span><strong>{movilidad === null ? "Por confirmar" : money(movilidad)}</strong></div>}
          <div><span>Total calculado</span><strong>{money(total)}</strong></div>
          <div><span>Adelanto requerido</span><strong>{money(required)}</strong></div>
          <div><span>Saldo pendiente</span><strong>{money(Math.max(total - paid, 0))}</strong></div>
          <div><span>Confirmación manual</span><strong>{economiaDomicilio?.ok && economiaDomicilio.requiresConfirmation ? "Sí" : "No"}</strong></div>
        </div>
        <div className="atencionGrid paymentFields">
          {personalizada && <><label className="atencionField">Precio final acordado<input name="precio_final" type="number" step="0.01" value={precioFinal} onChange={e=>setPrecioFinal(e.target.value)} placeholder={String(subtotalServicios)} /></label>{precioFinal && Number(precioFinal)!==subtotalServicios && <label className="atencionField atencionFieldWide">Motivo del ajuste<input name="motivo_ajuste" required /></label>}<label className="fichaConsent atencionFieldWide"><input name="confirmar_disponibilidad" value="1" type="checkbox" required /> Confirmo disponibilidad de cabinas y terapistas</label></>}
          <label className="atencionField">Monto recibido<input name="monto_pagado" type="number" min="0" step="0.01" value={paid} onChange={(event) => setPaid(Number(event.target.value || 0))} required /></label>
          <label className="atencionField">Método<select name="metodo_pago" disabled={paid <= 0} defaultValue=""><option value="">{paid > 0 ? "Selecciona" : "Convenio / sin adelanto"}</option>{metodos.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="atencionField">Número de operación<input name="numero_operacion" disabled={paid <= 0} /></label>
          <label className="atencionField atencionFieldWide">Observación<textarea name="observacion" rows={2} /></label>
        </div>
        {esDomicilio && economiaDomicilio?.ok && economiaDomicilio.feePen === null && <div className="formMessage error" role="alert">El distrito requiere confirmar manualmente la movilidad antes de guardar.</div>}
        <button type="submit" className="primaryButton saveFichaButton" disabled={pending || !hora || total <= 0 || paid < required || (esDomicilio && (!economiaDomicilio?.ok || economiaDomicilio.feePen === null))}>
          {pending ? "Guardando transacción…" : "Guardar cita, pago y generar enlace"}
        </button>
      </section>
    </form>
  );
}
