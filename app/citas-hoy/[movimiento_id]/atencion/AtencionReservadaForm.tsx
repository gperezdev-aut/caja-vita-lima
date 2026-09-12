"use client";

import { useActionState, useMemo, useState } from "react";
import {
  guardarAtencionReservadaAction,
  INITIAL_ATENCION_RESERVADA_STATE,
} from "@/app/citas-hoy/atencion-actions";

type Props = {
  requestId: string;
  movimientoId: string;
  reservaId: string;
  personas: number;
  total: number;
  pagado: number;
  pendiente: number;
  terapistas: string[];
  metodos: string[];
  terapistasActuales: Record<number, string>;
  comprobante: string;
};

function money(value: number) {
  return `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AtencionReservadaForm(props: Props) {
  const [state, action, pending] = useActionState(
    guardarAtencionReservadaAction,
    INITIAL_ATENCION_RESERVADA_STATE
  );
  const [pago, setPago] = useState(String(props.pendiente));
  const [metodo, setMetodo] = useState(props.pendiente > 0 ? props.metodos[0] ?? "" : "");
  const [seleccion, setSeleccion] = useState<Record<number, string>>(props.terapistasActuales);
  const pagoNumerico = Number(pago.replace(",", "."));
  const saldoPosterior = useMemo(
    () => Math.max(props.pendiente - (Number.isFinite(pagoNumerico) ? pagoNumerico : 0), 0),
    [pagoNumerico, props.pendiente]
  );

  if (state.ok) {
    return (
      <section className="panel atencionReservadaSuccess">
        <span aria-hidden="true">✓</span>
        <h2>{state.completada ? "Atención completada" : "Atención en curso"}</h2>
        <p>{state.mensaje}</p>
        <strong>Saldo: {money(state.pendiente ?? 0)}</strong>
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

      <section className="panel atencionReservadaSection">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Paso 1</p>
            <h2>Asigna terapista</h2>
            <p>Las líneas existentes se actualizan por persona; no se crean líneas nuevas.</p>
          </div>
        </div>
        <div className="atencionReservadaFields">
          {Array.from({ length: props.personas }, (_, index) => {
            const persona = index + 1;
            const value = seleccion[persona] ?? "";
            return (
              <div className="atencionReservadaTherapist" key={persona}>
                <label>
                  Terapista · Persona {persona}
                  <select
                    name={`terapista_${persona}`}
                    required
                    value={value}
                    onChange={(event) => setSeleccion((current) => ({ ...current, [persona]: event.target.value }))}
                  >
                    <option value="">Selecciona</option>
                    {props.terapistas.map((terapista) => <option key={terapista} value={terapista}>{terapista}</option>)}
                  </select>
                </label>
                {value === "Otro" && (
                  <label>
                    Nombre de la terapista
                    <input name={`terapista_otro_${persona}`} required maxLength={120} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel atencionReservadaSection">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Paso 2</p>
            <h2>Confirma el cobro</h2>
            <p>El adelanto registrado se conserva. Sólo se añade el monto recibido ahora.</p>
          </div>
        </div>
        <div className="atencionReservadaMoney">
          <div><span>Total</span><strong>{money(props.total)}</strong></div>
          <div><span>Pagado antes</span><strong>{money(props.pagado)}</strong></div>
          <div><span>Saldo actual</span><strong>{money(props.pendiente)}</strong></div>
          <div className={saldoPosterior > 0 ? "pending" : "complete"}><span>Saldo después</span><strong>{money(saldoPosterior)}</strong></div>
        </div>
        <div className="atencionReservadaFields">
          <label>
            Pago recibido ahora
            <input name="pago_restante" type="number" min="0" max={props.pendiente} step="0.01" required value={pago} onChange={(event) => setPago(event.target.value)} />
          </label>
          <label>
            Método de pago
            <select name="metodo_pago" required={pagoNumerico > 0} value={metodo} onChange={(event) => setMetodo(event.target.value)} disabled={pagoNumerico === 0}>
              <option value="">Selecciona</option>
              {props.metodos.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {pagoNumerico > 0 && metodo !== "EFECTIVO" && (
            <label>
              Número de operación
              <input name="numero_operacion" required maxLength={120} inputMode="text" />
            </label>
          )}
          <label className="wide">
            Observación
            <textarea name="observacion" maxLength={500} rows={3} placeholder="Opcional" />
          </label>
        </div>
        <div className="atencionReservadaNotice">
          <strong>Extras</strong>
          <span>No disponibles en este cierre: el sistema aún no tiene un catálogo/ledger auditable de extras.</span>
        </div>
        <div className="atencionReservadaNotice">
          <strong>Comprobante</strong>
          <span>{props.comprobante}. Se conserva en el mismo movimiento.</span>
        </div>
      </section>

      {state.error && <div className="alert" role="alert"><strong>{state.error}</strong></div>}
      {saldoPosterior > 0 && (
        <div className="alert">Con saldo pendiente, la cita quedará “En atención” y no se marcará como completada.</div>
      )}
      <div className="atencionReservadaSticky">
        <a href="/citas-hoy">Cancelar</a>
        <button type="submit" disabled={pending}>{pending ? "Confirmando…" : saldoPosterior === 0 ? "Finalizar atención" : "Iniciar atención"}</button>
      </div>
    </form>
  );
}
