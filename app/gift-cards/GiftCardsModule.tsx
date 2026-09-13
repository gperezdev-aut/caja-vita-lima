"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { addOneCalendarYear, formatGiftCardDate, validateGiftCardPayment, whatsappGiftCardUrl } from "@/lib/giftCards";
import { emitirGiftCardAction, type GiftCardActionState } from "./actions";

type Service = { code: string; name: string; duration: number; price: number };
type Client = { id: string; name: string; whatsapp: string };
const initialState: GiftCardActionState = { ok: false };
const steps = ["Personas", "Regalo", "Pago", "Confirmar"];

function money(value: number) {
  return `S/ ${Number(value || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SubmitGiftCard({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="primaryButton giftCardSubmit" type="submit" disabled={pending || disabled}>{pending ? "Emitiendo…" : "EMITIR GIFT CARD"}</button>;
}

export function GiftCardsModule({
  services, clients, methods, branches, requestId, today,
}: {
  services: Service[]; clients: Client[]; methods: string[]; branches: string[];
  requestId: string; today: string;
}) {
  const [state, action] = useActionState(emitirGiftCardAction, initialState);
  const [step, setStep] = useState(0); const [maxStep, setMaxStep] = useState(0);
  const [type, setType] = useState<"SERVICIO" | "MONTO">("SERVICIO");
  const [buyer, setBuyer] = useState(""); const [buyerId, setBuyerId] = useState("");
  const [buyerPhone, setBuyerPhone] = useState(""); const [beneficiary, setBeneficiary] = useState("");
  const [beneficiaryPhone, setBeneficiaryPhone] = useState(""); const [message, setMessage] = useState("");
  const [serviceCode, setServiceCode] = useState(""); const [amount, setAmount] = useState("");
  const [branch, setBranch] = useState(branches[0] ?? ""); const [method, setMethod] = useState("");
  const [received, setReceived] = useState(""); const [operation, setOperation] = useState("");
  const [stepError, setStepError] = useState("");
  const selectedService = services.find((item) => item.code === serviceCode);
  const value = type === "SERVICIO" ? selectedService?.price ?? 0 : Number(amount || 0);
  const expiration = addOneCalendarYear(today);
  const selectedClient = useMemo(() => clients.find((item) => item.name === buyer), [buyer, clients]);

  function changeBuyer(name: string) {
    setBuyer(name); const found = clients.find((item) => item.name === name);
    setBuyerId(found?.id ?? ""); if (found?.whatsapp) setBuyerPhone(found.whatsapp);
  }
  function goBack() { setStepError(""); setStep((current) => Math.max(0, current - 1)); }
  function next() {
    let error = "";
    if (step === 0 && (!buyer.trim() || !beneficiary.trim())) error = "Completa comprador y beneficiario.";
    if (step === 1 && type === "SERVICIO" && !selectedService) error = "Selecciona un servicio del catálogo activo.";
    if (step === 1 && type === "MONTO" && (!Number.isFinite(value) || value <= 0)) error = "Ingresa un monto válido mayor que cero.";
    if (step === 2) error = !branch ? "Selecciona la sede." : validateGiftCardPayment({ value, received: Number(received || 0), method, operation });
    if (error) { setStepError(error); return; }
    const target = step + 1; setStepError(""); setMaxStep((current) => Math.max(current, target)); setStep(target); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function chooseType(nextType: "SERVICIO" | "MONTO") {
    setType(nextType); setServiceCode(""); setAmount(""); setReceived(""); setStepError("");
  }
  const canSubmit = Boolean(buyer.trim() && beneficiary.trim() && value > 0 && branch && !validateGiftCardPayment({ value, received: Number(received || 0), method, operation }));

  if (state.ok && state.giftcardId && state.code) {
    const detailPath = `/gift-cards/${encodeURIComponent(state.giftcardId)}`;
    const viewUrl = typeof window === "undefined" ? detailPath : `${window.location.origin}${detailPath}`;
    const share = whatsappGiftCardUrl(beneficiaryPhone || buyerPhone, state.code, viewUrl);
    return <section className="panel giftCardSuccess" aria-live="polite"><span className="successMark">✓</span><p className="eyebrow">Gift Card emitida</p><h2>{state.code}</h2><p>Vigente hasta el {formatGiftCardDate(state.expiresAt || expiration)}.</p><div className="giftCardSuccessActions"><a className="primaryButton" href={`/api/gift-cards/${encodeURIComponent(state.giftcardId)}/download`}>Descargar Gift Card</a>{(beneficiaryPhone || buyerPhone) && <a className="ghostButton" href={share} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>}<Link className="ghostButton" href={detailPath}>Ver Gift Card</Link><Link className="ghostButton" href="/gift-cards">Emitir otra</Link></div></section>;
  }

  return <>
    <form action={action} className="panel giftCardWizard" noValidate>
      <input type="hidden" name="request_id" value={requestId}/><input type="hidden" name="tipo" value={type}/>
      <input type="hidden" name="comprador" value={buyer}/><input type="hidden" name="comprador_cliente_id" value={buyerId}/>
      <input type="hidden" name="whatsapp_comprador" value={buyerPhone}/><input type="hidden" name="beneficiario" value={beneficiary}/>
      <input type="hidden" name="whatsapp_beneficiario" value={beneficiaryPhone}/><input type="hidden" name="dedicatoria" value={message}/>
      <input type="hidden" name="service_code" value={serviceCode}/><input type="hidden" name="monto" value={value}/>
      <input type="hidden" name="sede" value={branch}/><input type="hidden" name="metodo_pago" value={method}/>
      <input type="hidden" name="numero_operacion" value={operation}/><input type="hidden" name="monto_recibido" value={received}/>
      <div className="giftCardStepper" aria-label="Progreso de emisión">{steps.map((label, index) => <button key={label} type="button" className={index === step ? "active" : index < step ? "done" : ""} disabled={index > maxStep} onClick={() => index <= maxStep && setStep(index)}><span>{index < step ? "✓" : index + 1}</span><small>{label}</small></button>)}</div>
      {state.error && <div className="formMessage error" role="alert">{state.error}</div>}
      {step === 0 && <section className="giftCardStep"><p className="stepKicker">Paso 1 de 4</p><h2>Tipo y beneficiario</h2><div className="giftCardTypeGrid"><button type="button" className={type === "SERVICIO" ? "selected" : ""} onClick={() => chooseType("SERVICIO")}><strong>Por servicio</strong><small>Un servicio canónico, un solo uso.</small></button><button type="button" className={type === "MONTO" ? "selected" : ""} onClick={() => chooseType("MONTO")}><strong>Por monto</strong><small>Saldo monetario con usos parciales.</small></button></div><div className="giftCardFormGrid"><label>Comprador<input list="gift-card-clients" value={buyer} onChange={(event) => changeBuyer(event.target.value)} autoComplete="name"/></label><label>WhatsApp comprador<input value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} inputMode="tel" placeholder="987 654 321"/></label><label>Beneficiario<input value={beneficiary} onChange={(event) => setBeneficiary(event.target.value)} autoComplete="name"/></label><label>WhatsApp beneficiario (opcional)<input value={beneficiaryPhone} onChange={(event) => setBeneficiaryPhone(event.target.value)} inputMode="tel"/></label><label className="wide">Dedicatoria (opcional)<textarea rows={2} value={message} maxLength={280} onChange={(event) => setMessage(event.target.value)}/></label></div><datalist id="gift-card-clients">{clients.map((client) => <option key={client.id} value={client.name}>{client.whatsapp}</option>)}</datalist>{selectedClient && <p className="fieldMessage">Cliente existente: {selectedClient.whatsapp || "sin WhatsApp"}</p>}</section>}
      {step === 1 && <section className="giftCardStep"><p className="stepKicker">Paso 2 de 4</p><h2>Define el regalo</h2>{type === "SERVICIO" ? <div className="giftCardServiceList">{services.map((service) => <button type="button" key={service.code} className={service.code === serviceCode ? "selected" : ""} onClick={() => { setServiceCode(service.code); setReceived(String(service.price)); }}><span><strong>{service.name}</strong><small>{service.duration} min · {service.code}</small></span><b>{money(service.price)}</b></button>)}</div> : <div className="giftCardAmount"><div className="amountChips">{[100,150,250].map((preset) => <button type="button" key={preset} onClick={() => { setAmount(String(preset)); setReceived(String(preset)); }}>{money(preset)}</button>)}</div><label>Monto personalizado<input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setReceived(event.target.value); }}/></label></div>}<div className="giftCardValue"><span>Valor</span><strong>{money(value)}</strong></div></section>}
      {step === 2 && <section className="giftCardStep"><p className="stepKicker">Paso 3 de 4</p><h2>Pago y vigencia</h2><div className="giftCardDates"><div><span>Emitida</span><strong>{formatGiftCardDate(today)}</strong></div><div><span>Vence</span><strong>{formatGiftCardDate(expiration)}</strong></div></div><div className="giftCardFormGrid"><label>Sede<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">Selecciona</option>{branches.map((item) => <option key={item}>{item}</option>)}</select></label><label>Método de pago<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="">Selecciona</option>{methods.map((item) => <option key={item}>{item}</option>)}</select></label><label>Monto recibido<input type="number" inputMode="decimal" min="0.01" step="0.01" value={received} onChange={(event) => setReceived(event.target.value)}/></label><label>Número de operación<input value={operation} disabled={!method || method.toUpperCase() === "EFECTIVO"} onChange={(event) => setOperation(event.target.value)} inputMode="numeric"/></label></div><p className="giftCardAccountingNote">La venta se registra como ingreso de Gift Card. El canje no vuelve a registrar el mismo ingreso.</p></section>}
      {step === 3 && <section className="giftCardStep"><p className="stepKicker">Paso 4 de 4</p><h2>Confirma y genera</h2><div className="giftCardConfirmation"><div><span>Comprador</span><strong>{buyer}</strong></div><div><span>Beneficiario</span><strong>{beneficiary}</strong></div><div><span>Tipo</span><strong>{type === "SERVICIO" ? "Por servicio" : "Por monto"}</strong></div><div><span>Regalo</span><strong>{type === "SERVICIO" ? selectedService?.name : money(value)}</strong></div>{selectedService && <div><span>Duración</span><strong>{selectedService.duration} min</strong></div>}<div><span>Total / pago</span><strong>{money(value)} · {method}</strong></div><div><span>Emisión</span><strong>{formatGiftCardDate(today)}</strong></div><div><span>Vencimiento</span><strong>{formatGiftCardDate(expiration)}</strong></div>{message && <div className="wide"><span>Dedicatoria</span><strong>{message}</strong></div>}</div><SubmitGiftCard disabled={!canSubmit}/></section>}
      {stepError && <div className="wizardError" role="alert">{stepError}</div>}<div className="giftCardWizardActions">{step > 0 && <button className="ghostButton" type="button" onClick={goBack}>Atrás</button>}{step < 3 && <button className="primaryButton" type="button" onClick={next}>Continuar</button>}</div>
    </form>
  </>;
}
