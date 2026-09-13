"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  addOneCalendarYear,
  formatGiftCardDate,
  validateGiftCardPayment,
} from "@/lib/giftCards";
import { normalizeGiftCardPresentationText } from "@/lib/giftCardTemplate";
import { findGiftCardClients, findGiftCardServices } from "@/lib/giftCardUx";
import { emitirGiftCardAction, type GiftCardActionState } from "./actions";
import { GiftCardShareButton } from "./GiftCardShareButton";

type Service = {
  code: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  description?: string;
};
type Client = { id: string; name: string; whatsapp: string };
const initialState: GiftCardActionState = { ok: false };
const steps = ["Personas", "Regalo", "Pago", "Confirmar"];
const serviceCategories = [
  "INDIVIDUAL",
  "PACKAGE_TWO",
  "HOME",
  "PROGRAM",
  "BEAUTY",
  "FACIAL",
];

function money(value: number) {
  return `S/ ${Number(value || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function categoryLabel(value: string) {
  return (
    (
      {
        INDIVIDUAL: "Individual",
        PACKAGE_TWO: "Pareja",
        HOME: "Domicilio",
        PROGRAM: "Programa",
        BEAUTY: "Belleza",
        FACIAL: "Facial",
      } as Record<string, string>
    )[value] ?? value
  );
}

function SubmitGiftCard({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="primaryButton giftCardSubmit"
      type="submit"
      disabled={pending || disabled}
    >
      {pending ? "Emitiendo…" : "EMITIR GIFT CARD"}
    </button>
  );
}

export function GiftCardsModule({
  services,
  clients,
  methods,
  branches,
  requestId,
  today,
}: {
  services: Service[];
  clients: Client[];
  methods: string[];
  branches: string[];
  requestId: string;
  today: string;
}) {
  const [state, action] = useActionState(emitirGiftCardAction, initialState);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [type, setType] = useState<"SERVICIO" | "MONTO">("SERVICIO");
  const [buyer, setBuyer] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [beneficiaryPhone, setBeneficiaryPhone] = useState("");
  const [message, setMessage] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [amount, setAmount] = useState("");
  const [branch, setBranch] = useState(branches[0] ?? "");
  const [method, setMethod] = useState("");
  const [received, setReceived] = useState("");
  const [operation, setOperation] = useState("");
  const [stepError, setStepError] = useState("");
  const [buyerResultsOpen, setBuyerResultsOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [serviceResultsOpen, setServiceResultsOpen] = useState(true);
  const selectedService = services.find((item) => item.code === serviceCode);
  const value =
    type === "SERVICIO" ? (selectedService?.price ?? 0) : Number(amount || 0);
  const expiration = addOneCalendarYear(today);
  const selectedClient = useMemo(
    () => clients.find((item) => item.id === buyerId),
    [buyerId, clients],
  );
  const buyerMatches = useMemo(
    () => findGiftCardClients(clients, buyer),
    [buyer, clients],
  );
  const serviceMatches = useMemo(
    () => findGiftCardServices(services, serviceQuery, 8, serviceCategory),
    [services, serviceQuery, serviceCategory],
  );

  function changeBuyer(name: string) {
    setBuyer(name);
    setBuyerId("");
    setBuyerResultsOpen(true);
  }
  function selectBuyer(client: Client) {
    setBuyer(client.name);
    setBuyerId(client.id);
    setBuyerPhone(client.whatsapp);
    setBuyerResultsOpen(false);
  }
  function selectService(service: Service) {
    setServiceCode(service.code);
    setServiceQuery(service.name);
    setReceived(String(service.price));
    setServiceResultsOpen(false);
  }
  function goBack() {
    setStepError("");
    setStep((current) => Math.max(0, current - 1));
  }
  function next() {
    let error = "";
    if (step === 0 && (!buyer.trim() || !beneficiary.trim()))
      error = "Completa comprador y beneficiario.";
    if (step === 1 && type === "SERVICIO" && !selectedService)
      error = "Selecciona un servicio del catálogo activo.";
    if (
      step === 1 &&
      type === "MONTO" &&
      (!Number.isFinite(value) || value <= 0)
    )
      error = "Ingresa un monto válido mayor que cero.";
    if (step === 2)
      error = !branch
        ? "Selecciona la sede."
        : validateGiftCardPayment({
            value,
            received: Number(received || 0),
            method,
            operation,
          });
    if (error) {
      setStepError(error);
      return;
    }
    const target = step + 1;
    setStepError("");
    setMaxStep((current) => Math.max(current, target));
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function chooseType(nextType: "SERVICIO" | "MONTO") {
    setType(nextType);
    setServiceCode("");
    setServiceQuery("");
    setServiceCategory("");
    setServiceResultsOpen(true);
    setAmount("");
    setReceived("");
    setStepError("");
  }
  const missingSubmitFields: string[] = [];
  if (!buyer.trim()) missingSubmitFields.push("comprador");
  if (!beneficiary.trim()) missingSubmitFields.push("beneficiario");
  if (type === "SERVICIO" && !selectedService)
    missingSubmitFields.push("servicio");
  if (type === "MONTO" && (!Number.isFinite(value) || value <= 0))
    missingSubmitFields.push("monto de la Gift Card");
  if (!branch) missingSubmitFields.push("sede");
  if (!method) missingSubmitFields.push("método de pago");
  if (!received || Number(received) !== value)
    missingSubmitFields.push(`monto recibido completo (${money(value)})`);
  if (
    method &&
    method.toUpperCase() !== "EFECTIVO" &&
    !operation.trim()
  )
    missingSubmitFields.push("número de operación");
  const canSubmit = missingSubmitFields.length === 0;

  if (state.ok && state.giftcardId && state.code) {
    const detailPath = `/gift-cards/${encodeURIComponent(state.giftcardId)}`;
    return (
      <section className="panel giftCardSuccess" aria-live="polite">
        <span className="successMark">✓</span>
        <p className="eyebrow">Gift Card emitida</p>
        <h2>{state.code}</h2>
        <p>
          Vigente hasta el {formatGiftCardDate(state.expiresAt || expiration)}.
        </p>
        <div className="giftCardSuccessActions">
          <a
            className="primaryButton"
            href={`/api/gift-cards/${encodeURIComponent(state.giftcardId)}/download`}
          >
            Descargar Gift Card
          </a>
          <Link className="ghostButton giftCardViewAction" href={detailPath}>
            Ver Gift Card
          </Link>
          {(beneficiaryPhone || buyerPhone) && (
            <GiftCardShareButton
              giftcardId={state.giftcardId}
              code={state.code}
              phone={beneficiaryPhone || buyerPhone}
            />
          )}
          <Link className="textButton" href="/gift-cards">
            Emitir otra
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <form action={action} className="panel giftCardWizard" noValidate>
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="tipo" value={type} />
        <input type="hidden" name="comprador" value={buyer} />
        <input type="hidden" name="comprador_cliente_id" value={buyerId} />
        <input type="hidden" name="whatsapp_comprador" value={buyerPhone} />
        <input type="hidden" name="beneficiario" value={beneficiary} />
        <input
          type="hidden"
          name="whatsapp_beneficiario"
          value={beneficiaryPhone}
        />
        <input type="hidden" name="dedicatoria" value={message} />
        <input type="hidden" name="service_code" value={serviceCode} />
        <input type="hidden" name="monto" value={value} />
        <input type="hidden" name="sede" value={branch} />
        <input type="hidden" name="metodo_pago" value={method} />
        <input type="hidden" name="numero_operacion" value={operation} />
        <input type="hidden" name="monto_recibido" value={received} />
        <div className="giftCardStepper" aria-label="Progreso de emisión">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              className={index === step ? "active" : index < step ? "done" : ""}
              disabled={index > maxStep}
              onClick={() => index <= maxStep && setStep(index)}
            >
              <span>{index < step ? "✓" : index + 1}</span>
              <small>{label}</small>
            </button>
          ))}
        </div>
        {state.error && (
          <div className="formMessage error" role="alert">
            {state.error}
          </div>
        )}
        {step === 0 && (
          <section className="giftCardStep">
            <p className="stepKicker">Paso 1 de 4</p>
            <h2>Tipo y beneficiario</h2>
            <div className="giftCardTypeGrid">
              <button
                type="button"
                className={type === "SERVICIO" ? "selected" : ""}
                onClick={() => chooseType("SERVICIO")}
              >
                <strong>Por servicio</strong>
                <small>Un servicio canónico, un solo uso.</small>
              </button>
              <button
                type="button"
                className={type === "MONTO" ? "selected" : ""}
                onClick={() => chooseType("MONTO")}
              >
                <strong>Por monto</strong>
                <small>Saldo monetario con usos parciales.</small>
              </button>
            </div>
            <div className="giftCardPeopleGrid">
              <section className="giftCardPersonGroup">
                <h3>Comprador</h3>
                <div
                  className="giftCardBuyerField"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      setBuyerResultsOpen(false);
                  }}
                >
                  <label htmlFor="gift-card-buyer">Nombre o WhatsApp</label>
                  <input
                    id="gift-card-buyer"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={buyerResultsOpen}
                    aria-controls="gift-card-buyer-results"
                    value={buyer}
                    onChange={(event) => changeBuyer(event.target.value)}
                    onFocus={() => setBuyerResultsOpen(true)}
                    autoComplete="off"
                    placeholder="Escribe para buscar o ingresar manualmente"
                  />
                  {buyerResultsOpen && buyer.trim() && (
                    <div
                      className="giftCardBuyerResults"
                      id="gift-card-buyer-results"
                      role="listbox"
                    >
                      {!buyerMatches.ready ? (
                        <p>Escribe al menos 2 caracteres para buscar.</p>
                      ) : buyerMatches.results.length ? (
                        buyerMatches.results.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            role="option"
                            aria-selected={client.id === buyerId}
                            onClick={() => selectBuyer(client)}
                          >
                            <strong>
                              {normalizeGiftCardPresentationText(client.name)}
                            </strong>
                            <small>{client.whatsapp || "Sin WhatsApp"}</small>
                          </button>
                        ))
                      ) : (
                        <p>
                          Sin coincidencias. Puedes ingresar el nombre
                          manualmente.
                        </p>
                      )}
                      {buyerMatches.total > buyerMatches.results.length && (
                        <small className="giftCardBuyerMore">
                          Sigue escribiendo para acotar {buyerMatches.total}{" "}
                          resultados.
                        </small>
                      )}
                    </div>
                  )}
                </div>
                <label>
                  WhatsApp comprador
                  <input
                    value={buyerPhone}
                    onChange={(event) => setBuyerPhone(event.target.value)}
                    inputMode="tel"
                    placeholder="987 654 321"
                  />
                </label>
                {selectedClient && (
                  <p className="fieldMessage">
                    Cliente seleccionado ·{" "}
                    {selectedClient.whatsapp || "sin WhatsApp"}
                  </p>
                )}
              </section>
              <section className="giftCardPersonGroup">
                <h3>Beneficiario</h3>
                <label>
                  Nombre
                  <input
                    value={beneficiary}
                    onChange={(event) => setBeneficiary(event.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label>
                  WhatsApp (opcional)
                  <input
                    value={beneficiaryPhone}
                    onChange={(event) =>
                      setBeneficiaryPhone(event.target.value)
                    }
                    inputMode="tel"
                    placeholder="Solo si deseas registrarlo"
                  />
                </label>
                <p className="giftCardFieldHint">
                  El beneficiario se registra como texto; no se crea ni modifica
                  un cliente.
                </p>
              </section>
            </div>
            <label className="giftCardDedication">
              Dedicatoria (opcional)
              <textarea
                rows={2}
                value={message}
                maxLength={280}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
          </section>
        )}
        {step === 1 && (
          <section className="giftCardStep">
            <p className="stepKicker">Paso 2 de 4</p>
            <h2>Define el regalo</h2>
            {type === "SERVICIO" ? (
              <div className="giftCardServicePicker">
                <div
                  className="giftCardServiceField"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      setServiceResultsOpen(false);
                  }}
                >
                  <label htmlFor="gift-card-service-search">
                    Buscar servicio
                  </label>
                  <div
                    className="giftCardCategoryChips"
                    aria-label="Filtrar por categoría"
                  >
                    <button
                      type="button"
                      className={!serviceCategory ? "selected" : ""}
                      aria-pressed={!serviceCategory}
                      onClick={() => {
                        setServiceCategory("");
                        setServiceResultsOpen(true);
                      }}
                    >
                      Todos
                    </button>
                    {serviceCategories.map((category) => (
                      <button
                        type="button"
                        key={category}
                        className={serviceCategory === category ? "selected" : ""}
                        aria-pressed={serviceCategory === category}
                        onClick={() => {
                          setServiceCategory(category);
                          setServiceCode("");
                          setServiceResultsOpen(true);
                        }}
                      >
                        {categoryLabel(category)}
                      </button>
                    ))}
                  </div>
                  <input
                    id="gift-card-service-search"
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={serviceResultsOpen}
                    aria-controls="gift-card-service-results"
                    value={serviceQuery}
                    onChange={(event) => {
                      setServiceQuery(event.target.value);
                      setServiceCode("");
                      setServiceResultsOpen(true);
                    }}
                    onFocus={() => setServiceResultsOpen(true)}
                    autoComplete="off"
                    placeholder="Nombre, código o categoría"
                  />
                  {serviceResultsOpen && (
                    <div
                      className="giftCardServiceList"
                      id="gift-card-service-results"
                      role="listbox"
                    >
                      {serviceMatches.results.length ? (
                        serviceMatches.results.map((service) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={service.code === serviceCode}
                            key={service.code}
                            className={
                              service.code === serviceCode ? "selected" : ""
                            }
                            onClick={() => selectService(service)}
                          >
                            <span>
                              <strong>
                                {normalizeGiftCardPresentationText(
                                  service.name,
                                )}
                              </strong>
                              <small>
                                {service.duration} min · {service.code} ·{" "}
                                {categoryLabel(service.category)}
                              </small>
                            </span>
                            <b>{money(service.price)}</b>
                          </button>
                        ))
                      ) : (
                        <p className="giftCardServiceEmpty">
                          No hay servicios que coincidan con la búsqueda.
                        </p>
                      )}
                      <small className="giftCardServiceMore" aria-live="polite">
                        {serviceQuery.trim() || serviceCategory
                          ? `Mostrando ${serviceMatches.results.length} de ${serviceMatches.total} coincidencias (${services.length} servicios)`
                          : `Mostrando ${serviceMatches.results.length} de ${services.length} servicios`}
                      </small>
                    </div>
                  )}
                </div>
                {selectedService && !serviceResultsOpen && (
                  <article className="giftCardSelectedService">
                    <span>
                      <small>Servicio seleccionado</small>
                      <strong>
                        {normalizeGiftCardPresentationText(
                          selectedService.name,
                        )}
                      </strong>
                      <small>
                        {selectedService.duration} min · {selectedService.code}{" "}
                        · {categoryLabel(selectedService.category)}
                      </small>
                    </span>
                    <b>{money(selectedService.price)}</b>
                  </article>
                )}
              </div>
            ) : (
              <div className="giftCardAmount">
                <div className="amountChips">
                  {[100, 150, 250].map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      onClick={() => {
                        setAmount(String(preset));
                        setReceived(String(preset));
                      }}
                    >
                      {money(preset)}
                    </button>
                  ))}
                </div>
                <label>
                  Monto personalizado
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setReceived(event.target.value);
                    }}
                  />
                </label>
              </div>
            )}
            <div className="giftCardValue">
              <span>Valor</span>
              <strong>{money(value)}</strong>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="giftCardStep">
            <p className="stepKicker">Paso 3 de 4</p>
            <h2>Pago y vigencia</h2>
            <div className="giftCardDates">
              <div>
                <span>Emitida</span>
                <strong>{formatGiftCardDate(today)}</strong>
              </div>
              <div>
                <span>Vence</span>
                <strong>{formatGiftCardDate(expiration)}</strong>
              </div>
            </div>
            <div className="giftCardFormGrid">
              <label>
                Sede
                <select
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {branches.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Método de pago
                <select
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                >
                  <option value="">Selecciona</option>
                  {methods.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Monto recibido
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={received}
                  onChange={(event) => setReceived(event.target.value)}
                />
              </label>
              <label>
                Número de operación
                <input
                  value={operation}
                  disabled={!method || method.toUpperCase() === "EFECTIVO"}
                  onChange={(event) => setOperation(event.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>
            <p className="giftCardAccountingNote">
              La venta se registra como ingreso de Gift Card. El canje no vuelve
              a registrar el mismo ingreso.
            </p>
          </section>
        )}
        {step === 3 && (
          <section className="giftCardStep">
            <p className="stepKicker">Paso 4 de 4</p>
            <h2>Confirma y genera</h2>
            <div className="giftCardConfirmation">
              <div>
                <span>Comprador</span>
                <strong>{normalizeGiftCardPresentationText(buyer)}</strong>
              </div>
              <div>
                <span>Beneficiario</span>
                <strong>
                  {normalizeGiftCardPresentationText(beneficiary)}
                </strong>
              </div>
              <div>
                <span>Tipo</span>
                <strong>
                  {type === "SERVICIO" ? "Por servicio" : "Por monto"}
                </strong>
              </div>
              <div>
                <span>Regalo</span>
                <strong>
                  {type === "SERVICIO"
                    ? normalizeGiftCardPresentationText(selectedService?.name)
                    : money(value)}
                </strong>
              </div>
              {selectedService && (
                <div>
                  <span>Duración</span>
                  <strong>{selectedService.duration} min</strong>
                </div>
              )}
              <div>
                <span>Total / pago</span>
                <strong>
                  {money(value)} · {method}
                </strong>
              </div>
              <div>
                <span>Emisión</span>
                <strong>{formatGiftCardDate(today)}</strong>
              </div>
              <div>
                <span>Vencimiento</span>
                <strong>{formatGiftCardDate(expiration)}</strong>
              </div>
              {message && (
                <div className="wide">
                  <span>Dedicatoria</span>
                  <strong>{normalizeGiftCardPresentationText(message)}</strong>
                </div>
              )}
            </div>
            {state.error && (
              <div className="formMessage error" role="alert">
                No se pudo emitir: {state.error}
              </div>
            )}
            {!canSubmit && (
              <div className="giftCardSubmitFeedback" role="status">
                <strong>No se puede emitir todavía.</strong>
                <span>
                  Falta completar: {missingSubmitFields.join(", ")}.
                </span>
              </div>
            )}
            {canSubmit && (
              <p className="giftCardSubmitReady" role="status">
                Todo listo para emitir la Gift Card.
              </p>
            )}
            <SubmitGiftCard disabled={!canSubmit} />
          </section>
        )}
        {stepError && (
          <div className="wizardError" role="alert">
            {stepError}
          </div>
        )}
        <div className="giftCardWizardActions">
          {step > 0 && (
            <button className="ghostButton" type="button" onClick={goBack}>
              Atrás
            </button>
          )}
          {step < 3 && (
            <button className="primaryButton" type="button" onClick={next}>
              Continuar
            </button>
          )}
        </div>
      </form>
    </>
  );
}
