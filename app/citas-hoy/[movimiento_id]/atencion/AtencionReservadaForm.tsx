"use client";

import { useActionState, useMemo, useState } from "react";
import {
  guardarAtencionReservadaAction,
  type AtencionReservadaState,
} from "@/app/citas-hoy/atencion-actions";
import { type EstadoActualAtencion } from "@/lib/atencionReservada";
import styles from "./AtencionReservadaForm.module.css";

type TherapistMaster = { id: string; nombre: string; aliases?: string[] };

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

const INITIAL_STATE: AtencionReservadaState = { ok: false };
const STEP_LABELS = ["Atención", "Extras", "Cobro", "Propina", "Confirmar"];

function money(value: number) {
  return `S/ ${Number(value || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(value: string) {
  const parsed = Number(String(value || "0").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es-PE");
}

export function AtencionReservadaForm(props: Props) {
  const [state, action, pending] = useActionState(guardarAtencionReservadaAction, INITIAL_STATE);
  const [step, setStep] = useState(1);
  const [clientError, setClientError] = useState("");
  const [seleccion, setSeleccion] = useState<Record<number, string>>(props.terapistasActuales);
  const [otros, setOtros] = useState<Record<number, string>>({});
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
  const saldoAntesPagos = Math.max(0, props.pendiente + totalExtras - totalAjustes - coberturaConvenio);
  const saldoEstimado = Math.max(0, saldoAntesPagos - totalPagosNuevos);

  const participantes = useMemo(() => {
    const seleccionados = new Set(Object.values(seleccion).filter((value) => value && value !== "Otro").map(normalized));
    return props.terapistasMaestro.filter((terapista) => {
      const nombres = [terapista.nombre, ...(terapista.aliases ?? [])].map(normalized);
      return nombres.some((nombre) => seleccionados.has(nombre));
    });
  }, [props.terapistasMaestro, seleccion]);

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
    .map((row) => ({ metodo: row.metodo, monto: num(row.monto), numero_operacion: row.numeroOperacion.trim() || null }));
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
    ? { monto: num(propinaMonto), metodo: propinaMetodo, numero_operacion: propinaOperacion.trim() || null, distribucion: distribucionPayload }
    : null;

  function validateCurrentStep() {
    setClientError("");
    if (step === 1) {
      for (let persona = 1; persona <= props.personas; persona += 1) {
        const value = seleccion[persona] ?? "";
        if (!value) return "Asigna una terapista a cada persona.";
        if (value === "Otro" && !String(otros[persona] ?? "").trim()) return "Indica el nombre de la terapista marcada como Otro.";
      }
    }
    if (step === 2) {
      if (extras.some((row) => !row.concepto.trim() || num(row.montoUnitario) <= 0 || num(row.cantidad || "1") <= 0 || (row.tipo === "MINUTOS_EXTRA" && num(row.duracion) <= 0))) {
        return "Completa o elimina los extras incompletos antes de continuar.";
      }
      if (ajustes.some((row) => num(row.monto) <= 0 || !row.motivo.trim())) return "Completa o elimina los descuentos/cortesías incompletos.";
      if (convenioActivo && (!convenioReferencia.trim() || coberturaConvenio <= 0)) return "Completa el registro y monto del convenio.";
    }
    if (step === 3 && saldoAntesPagos > 0) {
      for (const pago of pagos) {
        const filaUsada = Boolean(pago.metodo || pago.monto || pago.numeroOperacion);
        if (!filaUsada) continue;
        if (!pago.metodo || num(pago.monto) <= 0) return "Selecciona método y monto para cada pago utilizado.";
        if (pago.metodo !== "EFECTIVO" && !pago.numeroOperacion.trim()) return `Ingresa el número de operación del pago por ${pago.metodo}.`;
      }
      if (totalPagosNuevos > saldoAntesPagos) return "Los pagos ingresados superan el saldo disponible.";
    }
    if (step === 4 && propinaActiva) {
      const monto = num(propinaMonto);
      const distribuido = distribucionPayload.reduce((sum, item) => sum + item.monto, 0);
      if (monto <= 0 || !propinaMetodo) return "Completa el monto y método de la propina.";
      if (propinaMetodo !== "EFECTIVO" && !propinaOperacion.trim()) return "Ingresa el número de operación de la propina.";
      if (participantes.length === 0) return "No hay una terapista participante válida para distribuir la propina.";
      if (Math.abs(distribuido - monto) > 0.009) return "La distribución debe sumar exactamente el monto de la propina.";
    }
    return "";
  }

  function goNext() {
    const error = validateCurrentStep();
    if (error) {
      setClientError(error);
      return;
    }
    setStep((current) => Math.min(5, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function splitTipEqually() {
    const amount = num(propinaMonto);
    if (!amount || participantes.length === 0) return;
    const cents = Math.round(amount * 100);
    const base = Math.floor(cents / participantes.length);
    let remainder = cents - base * participantes.length;
    const next: Record<string, string> = {};
    for (const terapista of participantes) {
      const share = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      next[terapista.id] = (share / 100).toFixed(2);
    }
    setPropinaDistribucion(next);
  }

  if (state.ok) {
    const recipients = participantes
      .filter((terapista) => num(propinaDistribucion[terapista.id] ?? "") > 0)
      .map((terapista) => terapista.nombre)
      .join(" / ");
    return (
      <section className={`panel ${styles.success}`}>
        <span className={styles.successIcon} aria-hidden="true">✓</span>
        <h2>{state.completada ? "Atención completada" : "Atención actualizada"}</h2>
        <p>{state.mensaje}</p>
        <div className={styles.successGrid}>
          <div><span>Saldo pendiente</span><strong>{money(state.pendiente ?? 0)}</strong></div>
          {(state.propinaRegistrada ?? 0) > 0 && (
            <div><span>Propina registrada</span><strong>{money(state.propinaRegistrada ?? 0)}</strong><small>{recipients || "Terapista"}{propinaMetodo ? ` · ${propinaMetodo}` : ""}</small></div>
          )}
        </div>
        <a className="ghostButton" href="/citas-hoy">Volver a Citas de hoy</a>
      </section>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="request_id" value={props.requestId} />
      <input type="hidden" name="movimiento_id" value={props.movimientoId} />
      <input type="hidden" name="reserva_id" value={props.reservaId} />
      <input type="hidden" name="personas" value={props.personas} />
      <input type="hidden" name="extras_json" value={JSON.stringify(extrasPayload)} />
      <input type="hidden" name="ajustes_json" value={JSON.stringify(ajustesPayload)} />
      <input type="hidden" name="coberturas_json" value={JSON.stringify(coberturasPayload)} />
      <input type="hidden" name="pagos_json" value={JSON.stringify(pagosPayload)} />
      <input type="hidden" name="propina_json" value={JSON.stringify(propinaPayload)} />
      {Array.from({ length: props.personas }, (_, index) => {
        const persona = index + 1;
        return (
          <span key={`hidden-terapista-${persona}`}>
            <input type="hidden" name={`terapista_${persona}`} value={seleccion[persona] ?? ""} />
            <input type="hidden" name={`terapista_otro_${persona}`} value={otros[persona] ?? ""} />
          </span>
        );
      })}

      <nav className={styles.steps} aria-label="Progreso de conciliación">
        {STEP_LABELS.map((label, index) => {
          const number = index + 1;
          return <div key={label} className={`${styles.step} ${number === step ? styles.stepActive : ""} ${number < step ? styles.stepDone : ""}`}><span>{number < step ? "✓" : number}</span><strong>{label}</strong></div>;
        })}
      </nav>

      {step === 1 && (
        <section className={`panel ${styles.section}`}>
          <p className="eyebrow">Paso 1 de 5</p><h2>¿Quién realizó la atención?</h2><p className={styles.help}>Confirma una terapista por persona.</p>
          <div className={styles.grid}>
            {Array.from({ length: props.personas }, (_, index) => {
              const persona = index + 1;
              const value = seleccion[persona] ?? "";
              return (
                <div className={styles.compactCard} key={persona}>
                  <label>Terapista · Persona {persona}
                    <select value={value} onChange={(event) => setSeleccion((current) => ({ ...current, [persona]: event.target.value }))}>
                      <option value="">Selecciona</option>
                      {props.terapistas.map((terapista) => <option key={terapista} value={terapista}>{terapista}</option>)}
                    </select>
                  </label>
                  {value === "Otro" && <label>Nombre<input value={otros[persona] ?? ""} onChange={(event) => setOtros((current) => ({ ...current, [persona]: event.target.value }))} maxLength={120} /></label>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className={`panel ${styles.section}`}>
          <p className="eyebrow">Paso 2 de 5</p><h2>¿Hubo algo adicional?</h2><p className={styles.help}>Solo registra lo que realmente ocurrió.</p>
          {props.coberturaGiftCard > 0 && <div className={styles.coverage}><strong>Gift Card aplicada</strong><span>{money(props.coberturaGiftCard)} de cobertura · no genera ingreso nuevo</span></div>}
          <div className={styles.actionRow}>
            <button type="button" className="ghostButton" onClick={() => setExtras((items) => [...items, { tipo: "MINUTOS_EXTRA", concepto: "", cantidad: "1", montoUnitario: "", duracion: "10" }])}>+ Extra</button>
            <button type="button" className="ghostButton" onClick={() => setAjustes((items) => [...items, { tipo: "DESCUENTO", monto: "", motivo: "" }])}>+ Descuento / cortesía</button>
            <button type="button" className="ghostButton" onClick={() => setConvenioActivo((value) => !value)}>{convenioActivo ? "Quitar convenio" : "+ Bee / Cuponidad"}</button>
          </div>
          {extras.map((row, index) => (
            <div className={styles.lineItem} key={`extra-${index}`}>
              <label>Tipo<select value={row.tipo} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, tipo: e.target.value as ExtraRow["tipo"] } : item))}><option value="MINUTOS_EXTRA">Minutos extra</option><option value="PRODUCTO">Producto</option><option value="DECORACION">Decoración</option><option value="OTRO">Otro</option></select></label>
              <label>Concepto<input value={row.concepto} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, concepto: e.target.value } : item))} placeholder="Ej. +10 minutos" /></label>
              <label>Precio<input type="number" min="0.01" step="0.01" value={row.montoUnitario} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, montoUnitario: e.target.value } : item))} /></label>
              <label>Cant.<input type="number" min="0.01" step="0.01" value={row.cantidad} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, cantidad: e.target.value } : item))} /></label>
              {row.tipo === "MINUTOS_EXTRA" && <label>Minutos<input type="number" min="1" step="1" value={row.duracion} onChange={(e) => setExtras((items) => items.map((item, i) => i === index ? { ...item, duracion: e.target.value } : item))} /></label>}
              <button type="button" className="ghostButton" onClick={() => setExtras((items) => items.filter((_, i) => i !== index))}>Quitar</button>
            </div>
          ))}
          {ajustes.map((row, index) => (
            <div className={styles.lineItem} key={`ajuste-${index}`}>
              <label>Tipo<select value={row.tipo} onChange={(e) => setAjustes((items) => items.map((item, i) => i === index ? { ...item, tipo: e.target.value as AdjustmentRow["tipo"] } : item))}><option value="DESCUENTO">Descuento</option><option value="CORTESIA">Cortesía</option><option value="AJUSTE_PRECIO">Ajuste de precio</option></select></label>
              <label>Monto<input type="number" min="0.01" step="0.01" value={row.monto} onChange={(e) => setAjustes((items) => items.map((item, i) => i === index ? { ...item, monto: e.target.value } : item))} /></label>
              <label className={styles.grow}>Motivo<input value={row.motivo} onChange={(e) => setAjustes((items) => items.map((item, i) => i === index ? { ...item, motivo: e.target.value } : item))} placeholder="Ej. cliente frecuente" /></label>
              <button type="button" className="ghostButton" onClick={() => setAjustes((items) => items.filter((_, i) => i !== index))}>Quitar</button>
            </div>
          ))}
          {convenioActivo && <div className={styles.lineItem}><label>Convenio<select value={convenioTipo} onChange={(e) => setConvenioTipo(e.target.value as typeof convenioTipo)}><option value="CONVENIO_BEE">Bee Beneficios</option><option value="CONVENIO_CUPONIDAD">Cuponidad</option></select></label><label className={styles.grow}>ID / registro<input value={convenioReferencia} onChange={(e) => setConvenioReferencia(e.target.value)} /></label><label>Monto reconocido<input type="number" min="0.01" step="0.01" value={convenioMonto} onChange={(e) => setConvenioMonto(e.target.value)} /></label></div>}
          {!extras.length && !ajustes.length && !convenioActivo && props.coberturaGiftCard <= 0 && <div className={styles.emptyState}>Sin extras, descuentos ni convenios. Puedes continuar.</div>}
        </section>
      )}

      {step === 3 && (
        <section className={`panel ${styles.section}`}>
          <p className="eyebrow">Paso 3 de 5</p><h2>Cobro</h2><p className={styles.help}>Registra solo el dinero nuevo que recibe Vita Lima.</p>
          <div className={styles.moneyGrid}>
            <div><span>Total</span><strong>{money(totalFinalEstimado)}</strong></div>
            <div><span>Pagado antes</span><strong>{money(props.pagado)}</strong></div>
            {props.coberturaGiftCard > 0 && <div><span>Gift Card</span><strong>{money(props.coberturaGiftCard)}</strong></div>}
            {coberturaConvenio > 0 && <div><span>Convenio</span><strong>{money(coberturaConvenio)}</strong></div>}
            <div className={styles.importantMoney}><span>Saldo por cobrar</span><strong>{money(saldoAntesPagos)}</strong></div>
          </div>
          {saldoAntesPagos <= 0 ? (
            <div className={styles.noPayment}><strong>No hay saldo por cobrar.</strong><span>La atención ya está cubierta. No necesitas registrar un pago.</span></div>
          ) : (
            <>
              <div className={styles.paymentList}>
                {pagos.map((row, index) => (
                  <div className={styles.paymentRow} key={`pago-${index}`}>
                    <label>Método<select value={row.metodo} onChange={(e) => setPagos((items) => items.map((item, i) => i === index ? { ...item, metodo: e.target.value } : item))}><option value="">Selecciona</option>{props.metodos.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                    <label>Monto<input type="number" min="0.01" step="0.01" value={row.monto} onChange={(e) => setPagos((items) => items.map((item, i) => i === index ? { ...item, monto: e.target.value } : item))} /></label>
                    {row.metodo && row.metodo !== "EFECTIVO" && <label className={styles.grow}>N.º operación<input value={row.numeroOperacion} onChange={(e) => setPagos((items) => items.map((item, i) => i === index ? { ...item, numeroOperacion: e.target.value } : item))} /></label>}
                    {pagos.length > 1 && <button type="button" className="ghostButton" onClick={() => setPagos((items) => items.filter((_, i) => i !== index))}>Quitar</button>}
                  </div>
                ))}
              </div>
              <button type="button" className="ghostButton" onClick={() => setPagos((items) => [...items, { metodo: "", monto: "", numeroOperacion: "" }])}>+ Otro método de pago</button>
              <div className={`${styles.balanceAfter} ${saldoEstimado > 0 ? styles.balancePending : styles.balanceOk}`}><span>Saldo estimado después</span><strong>{money(saldoEstimado)}</strong></div>
            </>
          )}
        </section>
      )}

      {step === 4 && (
        <section className={`panel ${styles.section}`}>
          <p className="eyebrow">Paso 4 de 5</p><h2>Propina</h2><p className={styles.help}>Es dinero de las terapistas y no aumenta la venta de Vita Lima.</p>
          <label className={styles.checkRow}><input type="checkbox" checked={propinaActiva} onChange={(e) => setPropinaActiva(e.target.checked)} /> El cliente dejó propina</label>
          {propinaActiva && <div className={styles.tipGrid}>
            <label>Monto<input type="number" min="0.01" step="0.01" value={propinaMonto} onChange={(e) => setPropinaMonto(e.target.value)} /></label>
            <label>Método<select value={propinaMetodo} onChange={(e) => setPropinaMetodo(e.target.value)}><option value="">Selecciona</option>{props.metodos.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            {propinaMetodo && propinaMetodo !== "EFECTIVO" && <label>N.º operación<input value={propinaOperacion} onChange={(e) => setPropinaOperacion(e.target.value)} /></label>}
            <div className={styles.tipDistribution}>
              <div className={styles.tipTitle}><strong>Distribución</strong>{participantes.length > 1 && <button type="button" className="ghostButton" onClick={splitTipEqually}>Dividir por igual</button>}</div>
              {participantes.length ? participantes.map((terapista) => <label key={terapista.id}>{terapista.nombre}<input type="number" min="0" step="0.01" value={propinaDistribucion[terapista.id] ?? ""} onChange={(e) => setPropinaDistribucion((current) => ({ ...current, [terapista.id]: e.target.value }))} placeholder="S/ 0.00" /></label>) : <div className={styles.emptyState}>Primero selecciona la terapista que realizó la atención.</div>}
            </div>
          </div>}
        </section>
      )}

      {step === 5 && (
        <section className={`panel ${styles.section}`}>
          <p className="eyebrow">Paso 5 de 5</p><h2>Confirma antes de guardar</h2><p className={styles.help}>Revisa los importes. La operación se guarda de forma atómica.</p>
          <div className={styles.reviewGrid}>
            <div><span>Total atención</span><strong>{money(totalFinalEstimado)}</strong></div>
            <div><span>Pagado antes</span><strong>{money(props.pagado)}</strong></div>
            {totalExtras > 0 && <div><span>Extras</span><strong>+ {money(totalExtras)}</strong></div>}
            {totalAjustes > 0 && <div><span>Descuentos / ajustes</span><strong>- {money(totalAjustes)}</strong></div>}
            {props.coberturaGiftCard > 0 && <div><span>Gift Card</span><strong>{money(props.coberturaGiftCard)}</strong></div>}
            {coberturaConvenio > 0 && <div><span>Convenio</span><strong>{money(coberturaConvenio)}</strong></div>}
            <div><span>Pagos nuevos Vita Lima</span><strong>{money(totalPagosNuevos)}</strong></div>
            {propinaActiva && <div><span>Propina aparte</span><strong>{money(num(propinaMonto))}</strong></div>}
            <div className={styles.reviewImportant}><span>Pendiente</span><strong>{money(saldoEstimado)}</strong></div>
          </div>
          <div className={styles.coverage}><strong>Comprobante</strong><span>{props.comprobante}. Se conserva en el mismo movimiento.</span></div>
          <label className={styles.observation}>Observación<textarea name="observacion" maxLength={500} rows={3} placeholder="Opcional" /></label>
        </section>
      )}

      {(clientError || state.error) && <div className="alert" role="alert"><strong>{clientError || state.error}</strong></div>}
      {step === 5 && saldoEstimado > 0 && <div className="alert">Quedará saldo pendiente y la atención seguirá “En atención”.</div>}

      <div className={styles.sticky}>
        {step === 1 ? <a href="/citas-hoy">Cancelar</a> : <button type="button" className="ghostButton" onClick={() => { setClientError(""); setStep((current) => Math.max(1, current - 1)); }}>← Atrás</button>}
        {step < 5 ? <button type="button" className={styles.primary} onClick={goNext}>Continuar</button> : <button type="submit" className={styles.primary} disabled={pending}>{pending ? "Conciliando…" : saldoEstimado === 0 ? "Finalizar atención" : props.estadoActual === "En atención" ? "Actualizar atención" : "Iniciar atención"}</button>}
      </div>
    </form>
  );
}
