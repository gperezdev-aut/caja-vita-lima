"use client";

import { useActionState, useMemo, useState } from "react";
import {
  guardarAtencionReservadaAction,
  type AtencionReservadaState,
} from "@/app/citas-hoy/atencion-actions";
import { type EstadoActualAtencion } from "@/lib/atencionReservada";

type TherapistMaster = { id: string; nombre: string };

type Props = {
  requestId: string;
  movimientoId: string;
  reservaId: string;
  personas: number;
  total: number;
  pagado: number;
  pendiente: number;
  terapistas: string[];
  terapistasMaestro: TherapistMaster[];
  metodos: string[];
  terapistasActuales: Record<number, string>;
  comprobante: string;
  estadoActual: EstadoActualAtencion;
  coberturaGiftCard: number;
  giftCardId: string | null;
};

type PaymentRow = { metodo: string; monto: string; numeroOperacion: string };
type ExtraRow = {
  tipo: "MINUTOS_EXTRA" | "PRODUCTO" | "DECORACION" | "OTRO";
  concepto: string;
  cantidad: string;
  montoUnitario: string;
  duracion: string;
};

type AdjustmentRow = {
  tipo: "DESCUENTO" | "CORTESIA" | "AJUSTE_PRECIO";
  monto: string;
  motivo: string;
};

const INITIAL_ATENCION_RESERVADA_STATE: AtencionReservadaState = { ok: false };

function money(value: number) {
  return `S/ ${Number(value || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(value: string) {
  const parsed = Number(String(value || "0").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function AtencionReservadaForm(props: Props) {
  const [state, action, pending] = useActionState(guardarAtencionReservadaAction, INITIAL_ATENCION_RESERVADA_STATE);
  const [seleccion, setSeleccion] = useState<Record<number, string>>(props.terapistasActuales);
  const [pagos, setPagos] = useState<PaymentRow[]>([{ metodo: "", monto: "", numeroOperacion: "" }]);
  const [extras, setExtras] = useState<ExtraRow[]>([]);
  const [ajustes, setAjustes] = useState<AdjustmentRow[]>([]);
  const [convenioActivo, setConvenioActivo] = useState(false);
  const [convenioTipo, setConvenioTipo] = useState<"CONVENIO_BEE" | "CONVENIO_CUPONIDAD">("CONVENIO_BEE");
  const [convenioReferencia, setConvenioReferencia] = useState("");
  const [convenioMonto, setConvenioMonto] = useState("");
  const [propinaActiva, setPropinaActiva] = useState(false);
  const [propinaMonto, setPropinaMonto] = useState("");
  const [propinaMetodo, setPropinaMetodo] = useState("");
  const [propinaOperacion, setPropinaOperacion] = useState("");
  const [propinaDistribucion, setPropinaDistribucion] = useState<Record<string, string>>({});

  const totalExtras = useMemo(
    () => extras.reduce((sum, row) => sum + num(row.cantidad || "1") * num(row.montoUnitario), 0),
    [extras]
  );
  const totalAjustes = useMemo(() => ajustes.reduce((sum, row) => sum + num(row.monto), 0), [ajustes]);
  const totalPagosNuevos = useMemo(() => pagos.reduce((sum, row) => sum + num(row.monto), 0), [pagos]);
  const coberturaConvenio = convenioActivo ? num(convenioMonto) : 0;
  const totalFinalEstimado = Math.max(0, props.total + totalExtras - totalAjustes);
  const saldoEstimado = Math.max(0, props.pendiente + totalExtras - totalAjustes - coberturaConvenio - totalPagosNuevos);

  const extrasPayload = extras
    .filter((row) => row.concepto.trim() && num(row.montoUnitario) > 0)
    .map((row) => ({
      tipo: row.tipo,
      concepto: row.concepto.trim(),
      cantidad: num(row.cantidad || "1"),
      monto_unitario: num(row.montoUnitario),
      duracion_extra_min: Math.max(0, Math.trunc(num(row.duracion))),
      persona_n: null,
    }));
  const ajustesPayload = ajustes
    .filter((row) => num(row.monto) > 0 && row.motivo.trim())
    .map((row) => ({ tipo: row.tipo, monto: num(row.monto), motivo: row.motivo.trim() }));
  const pagosPayload = pagos
    .filter((row) => num(row.monto) > 0)
    .map((row) => ({
      metodo: row.metodo,
      monto: num(row.monto),
      numero_operacion: row.numeroOperacion.trim() || null,
    }));
  const coberturasPayload = [
    ...(props.coberturaGiftCard > 0 && props.giftCardId
      ? [{ tipo: "GIFT_CARD", referencia_id: props.giftCardId, monto: props.coberturaGiftCard }]
      : []),
    ...(convenioActivo && convenioReferencia.trim() && coberturaConvenio > 0
      ? [{ tipo: convenioTipo, referencia_id: convenioReferencia.trim(), monto: coberturaConvenio }]
      : []),
  ];
  const distribucionPayload = Object.entries(propinaDistribucion)
    .map(([terapista_id, monto]) => ({ terapista_id, monto: num(monto) }))
    .filter((item) => item.monto > 0);
  const propinaPayload = propinaActiva && num(propinaMonto) > 0
    ? {
        monto: num(propinaMonto),
        metodo: propinaMetodo,
        numero_operacion: propinaOperacion.trim() || null,
        distribucion: distribucionPayload,
      }
    : null;

  if (state.ok) {
    return (
      <section className="panel atencionReservadaSuccess">
        <span aria-hidden="true">✓</span>
        <h2>{state.completada ? "Atención completada" : "Atención en curso"}</h2>
        <p>{state.mensaje}</p>
        <strong>Saldo: {money(state.pendiente ?? 0)}</strong>
        {(state.propinaRegistrada ?? 0) > 0 && <small>Propina registrada aparte: {money(state.propinaRegistrada ?? 0)}</small>}
        <a className="atencionReservadaPrimary" href="/citas-hoy">Volver a Citas de hoy</a>
      </section>
    );
  }

  return (
    <form action={action} className="atencionReservadaForm">
      <input type="hidden" name="request_id" value={props.requestId} />
      <input type="hidden" name="movimiento_id" value={props.movimientoId} />
      <input type="hidden" name="reserva_id" value={props.reservaId} />
      <input type="hidden" name="personas" value={props.personas} />
      <input type="hidden" name="extras_json" value={JSON.stringify(extrasPayload)} />
      <input type="hidden" name="ajustes_json" value={JSON.stringify(ajustesPayload)} />
      <input type="hidden" name="coberturas_json" value={JSON.stringify(coberturasPayload)} />
      <input type="hidden" name="pagos_json" value={JSON.stringify(pagosPayload)} />
      <input type="hidden" name="propina_json" value={JSON.stringify(propinaPayload)} />

      <section className="panel atencionReservadaSection">
        <div className="panelTitle"><div><p className="eyebrow">Paso 1</p><h2>Atención</h2><p>Confirma quién atendió a cada persona.</p></div></div>
        <div className="atencionReservadaFields">
          {Array.from({ length: props.personas }, (_, index) => {
            const persona = index + 1;
            const value = seleccion[persona] ?? "";
            return (
              <div className="atencionReservadaTherapist" key={persona}>
                <label>Terapista · Persona {persona}
                  <select name={`terapista_${persona}`} required value={value} onChange={(event) => setSeleccion((current) => ({ ...current, [persona]: event.target.value }))}>
                    <option value="">Selecciona</option>
                    {props.terapistas.map((terapista) => <option key={terapista} value={terapista}>{terapista}</option>)}
                  </select>
                </label>
                {value === "Otro" && <label>Nombre de la terapista<input name={`terapista_otro_${persona}`} required maxLength={120} /></label>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel atencionReservadaSection">
        <div className="panelTitle"><div><p className="eyebrow">Paso 2</p><h2>Extras y ajustes</h2><p>Solo abre lo que realmente ocurrió en esta atención.</p></div></div>

        <details>
          <summary><strong>Agregar upselling / extra</strong></summary>
          <div className="atencionReservadaFields" style={{ marginTop: 14 }}>
            {extras.map((row, index) => (
              <div className="atencionReservadaTherapist" key={`extra-${index}`}>
                <label>Tipo<select value={row.tipo} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, tipo: e.target.value as ExtraRow["tipo"] } : item))}><option value="MINUTOS_EXTRA">Minutos extra</option><option value="PRODUCTO">Producto</option><option value="DECORACION">Decoración</option><option value="OTRO">Otro</option></select></label>
                <label>Concepto<input value={row.concepto} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, concepto: e.target.value } : item))} placeholder="Ej. +10 minutos" /></label>
                <label>Precio unitario<input type="number" min="0" step="0.01" value={row.montoUnitario} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, montoUnitario: e.target.value } : item))} /></label>
                <label>Cantidad<input type="number" min="0.01" step="0.01" value={row.cantidad} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, cantidad: e.target.value } : item))} /></label>
                {row.tipo === "MINUTOS_EXTRA" && <label>Minutos añadidos<input type="number" min="0" step="1" value={row.duracion} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, duracion: e.target.value } : item))} /></label>}
                <button type="button" className="ghostButton" onClick={() => setExtras((items) => items.filter((_, i) => i !== index))}>Quitar</button>
              </div>
            ))}
            <button type="button" className="ghostButton" onClick={() => setExtras((items) => [...items, { tipo: "MINUTOS_EXTRA", concepto: "", cantidad: "1", montoUnitario: "", duracion: "10" }])}>+ Agregar extra</button>
          </div>
        </details>

        <details style={{ marginTop: 14 }}>
          <summary><strong>Aplicar descuento / cortesía</strong></summary>
          <div className="atencionReservadaFields" style={{ marginTop: 14 }}>
            {ajustes.map((row, index) => (
              <div className="atencionReservadaTherapist" key={`ajuste-${index}`}>
                <label>Tipo<select value={row.tipo} onChange={(e) => setAjustes((items) => items.map((item, i) => i === index ? { ...item, tipo: e.target.value as AdjustmentRow["tipo"] } : item))}><option value="DESCUENTO">Descuento</option><option value="CORTESIA">Cortesía</option><option value="AJUSTE_PRECIO">Ajuste de precio</option></select></label>
                <label>Monto<input type="number" min="0" step="0.01" value={row.monto} onChange={(e) => setAjustes((items) => items.map((item, i) => i === index ? { ...item, monto: e.target.value } : item))} /></label>
                <label className="wide">Motivo<input value={row.motivo} onChange={(e) => setAjustes((items) => items.map((item, i) => i === index ? { ...item, motivo: e.target.value } : item))} placeholder="Ej. cliente frecuente" /></label>
                <button type="button" className="ghostButton" onClick={() => setAjustes((items) => items.filter((_, i) => i !== index))}>Quitar</button>
              </div>
            ))}
            <button type="button" className="ghostButton" onClick={() => setAjustes((items) => [...items, { tipo: "DESCUENTO", monto: "", motivo: "" }])}>+ Agregar ajuste</button>
          </div>
        </details>

        <details style={{ marginTop: 14 }} open={convenioActivo}>
          <summary onClick={(e) => { e.preventDefault(); setConvenioActivo((value) => !value); }}><strong>Bee Beneficios / Cuponidad</strong></summary>
          {convenioActivo && <div className="atencionReservadaFields" style={{ marginTop: 14 }}>
            <label>Convenio<select value={convenioTipo} onChange={(e) => setConvenioTipo(e.target.value as typeof convenioTipo)}><option value="CONVENIO_BEE">Bee Beneficios</option><option value="CONVENIO_CUPONIDAD">Cuponidad</option></select></label>
            <label>ID / registro del convenio<input value={convenioReferencia} onChange={(e) => setConvenioReferencia(e.target.value)} /></label>
            <label>Monto reconocido<input type="number" min="0" step="0.01" value={convenioMonto} onChange={(e) => setConvenioMonto(e.target.value)} /></label>
            <small className="wide">Debe coincidir con el monto reconocido guardado en el registro del convenio.</small>
          </div>}
        </details>

        {props.coberturaGiftCard > 0 && <div className="atencionReservadaNotice" style={{ marginTop: 14 }}><strong>Gift Card</strong><span>Se aplicarán {money(props.coberturaGiftCard)} como cobertura. No genera ingreso nuevo.</span></div>}
      </section>

      <section className="panel atencionReservadaSection">
        <div className="panelTitle"><div><p className="eyebrow">Paso 3</p><h2>Cobro</h2><p>Divide el saldo entre tantos métodos como necesites.</p></div></div>
        <div className="atencionReservadaMoney">
          <div><span>Total antes</span><strong>{money(props.total)}</strong></div>
          {totalExtras > 0 && <div><span>Extras</span><strong>+ {money(totalExtras)}</strong></div>}
          {totalAjustes > 0 && <div><span>Ajustes</span><strong>- {money(totalAjustes)}</strong></div>}
          <div><span>Total estimado</span><strong>{money(totalFinalEstimado)}</strong></div>
          <div><span>Pagado antes</span><strong>{money(props.pagado)}</strong></div>
          {props.coberturaGiftCard > 0 && <div><span>Gift Card</span><strong>{money(props.coberturaGiftCard)}</strong></div>}
          {coberturaConvenio > 0 && <div><span>Convenio</span><strong>{money(coberturaConvenio)}</strong></div>}
          <div><span>Saldo actual</span><strong>{money(props.pendiente)}</strong></div>
          <div className={saldoEstimado > 0 ? "pending" : "complete"}><span>Saldo estimado después</span><strong>{money(saldoEstimado)}</strong></div>
        </div>

        <div className="atencionReservadaFields">
          {pagos.map((row, index) => (
            <div className="atencionReservadaTherapist" key={`pago-${index}`}>
              <label>Método<select value={row.metodo} onChange={(e) => setPagos((items) => items.map((item, i) => i === index ? { ...item, metodo: e.target.value } : item))}><option value="">Selecciona</option>{props.metodos.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>Monto<input type="number" min="0" step="0.01" value={row.monto} onChange={(e) => setPagos((items) => items.map((item, i) => i === index ? { ...item, monto: e.target.value } : item))} /></label>
              {row.metodo && row.metodo !== "EFECTIVO" && <label>Número de operación<input value={row.numeroOperacion} onChange={(e) => setPagos((items) => items.map((item, i) => i === index ? { ...item, numeroOperacion: e.target.value } : item))} /></label>}
              {pagos.length > 1 && <button type="button" className="ghostButton" onClick={() => setPagos((items) => items.filter((_, i) => i !== index))}>Quitar pago</button>}
            </div>
          ))}
          <button type="button" className="ghostButton" onClick={() => setPagos((items) => [...items, { metodo: "", monto: "", numeroOperacion: "" }])}>+ Otro método de pago</button>
        </div>
      </section>

      <section className="panel atencionReservadaSection">
        <div className="panelTitle"><div><p className="eyebrow">Paso 4</p><h2>Propina</h2><p>Opcional. Se registra aparte y no aumenta la venta de Vita Lima.</p></div></div>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={propinaActiva} onChange={(e) => setPropinaActiva(e.target.checked)} /> El cliente dejó propina</label>
        {propinaActiva && <div className="atencionReservadaFields" style={{ marginTop: 14 }}>
          <label>Monto de propina<input type="number" min="0" step="0.01" value={propinaMonto} onChange={(e) => setPropinaMonto(e.target.value)} /></label>
          <label>Método<select value={propinaMetodo} onChange={(e) => setPropinaMetodo(e.target.value)}><option value="">Selecciona</option>{props.metodos.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          {propinaMetodo && propinaMetodo !== "EFECTIVO" && <label>Número de operación<input value={propinaOperacion} onChange={(e) => setPropinaOperacion(e.target.value)} /></label>}
          <div className="wide"><strong>Distribución a terapistas</strong>{props.terapistasMaestro.map((terapista) => <label key={terapista.id} style={{ marginTop: 8 }}>{terapista.nombre}<input type="number" min="0" step="0.01" value={propinaDistribucion[terapista.id] ?? ""} onChange={(e) => setPropinaDistribucion((current) => ({ ...current, [terapista.id]: e.target.value }))} placeholder="S/ 0.00" /></label>)}</div>
          <small className="wide">La suma distribuida debe ser exactamente igual al monto de propina.</small>
        </div>}
      </section>

      <section className="panel atencionReservadaSection">
        <div className="panelTitle"><div><p className="eyebrow">Paso 5</p><h2>Confirmar</h2><p>La operación se guarda de forma atómica: o entra todo o no entra nada.</p></div></div>
        <div className="atencionReservadaNotice"><strong>Comprobante</strong><span>{props.comprobante}. Se conserva en el mismo movimiento.</span></div>
        <label className="wide" style={{ display: "block", marginTop: 14 }}>Observación<textarea name="observacion" maxLength={500} rows={3} placeholder="Opcional" /></label>
      </section>

      {state.error && <div className="alert" role="alert"><strong>{state.error}</strong></div>}
      {saldoEstimado > 0 && <div className="alert">Con saldo pendiente, la cita quedará “En atención” y no se marcará como completada.</div>}
      <div className="atencionReservadaSticky">
        <a href="/citas-hoy">Cancelar</a>
        <button type="submit" disabled={pending}>{pending ? "Conciliando…" : saldoEstimado === 0 ? "Finalizar atención" : props.estadoActual === "En atención" ? "Actualizar atención" : "Iniciar atención"}</button>
      </div>
    </form>
  );
}
