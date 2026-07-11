"use client";

import { useMemo, useState } from "react";

type CatalogService = {
  codeId: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  paxType: string;
  sortOrder: number;
};

type Promotion = {
  code: string;
  name: string;
  headline: string;
  duration: number;
  price1p: number;
  price2p: number;
  includes: string;
};

type Props = {
  services: CatalogService[];
  promotions: Promotion[];
  sedes: string[];
  metodos: string[];
  terapistas: string[];
  estadosBoleta: string[];
  responsables: string[];
  defaultDate: string;
  defaultTime: string;
  canSaveCatalog: boolean;
};

function money(value: number) {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  }).format(value);
}

export function NuevaAtencionWizard({
  services,
  promotions,
  sedes,
  metodos,
  terapistas,
  estadosBoleta,
  responsables,
  defaultDate,
  defaultTime,
  canSaveCatalog,
}: Props) {
  const [step, setStep] = useState(1);
  const [tipo, setTipo] = useState("ATENCION");
  const [fecha, setFecha] = useState(defaultDate);
  const [hora, setHora] = useState(defaultTime);
  const [sede, setSede] = useState("");

  const [cliente, setCliente] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [dni, setDni] = useState("");
  const [pax, setPax] = useState(1);

  const [serviceCode, setServiceCode] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
  const [customService, setCustomService] = useState(false);
  const [customName, setCustomName] = useState("");
  const [duration, setDuration] = useState(60);
  const [total, setTotal] = useState(0);
  const [saveCatalog, setSaveCatalog] = useState(false);
  const [terapista1, setTerapista1] = useState("");
  const [terapista2, setTerapista2] = useState("");

  const [paid, setPaid] = useState(0);
  const [metodo, setMetodo] = useState("");
  const [estadoBoleta, setEstadoBoleta] = useState("Pendiente");
  const [numeroBoleta, setNumeroBoleta] = useState("");
  const [responsable, setResponsable] = useState("Gerald");
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState("");

  const selectedService = useMemo(
    () => services.find((item) => item.codeId === serviceCode),
    [services, serviceCode]
  );

  const selectedPromotion = useMemo(
    () => promotions.find((item) => item.code === promotionCode),
    [promotions, promotionCode]
  );

  const filteredServices = useMemo(() => {
    const expected = pax === 2 ? "2p" : "1p";
    return services.filter((item) => {
      const category = item.category.toLowerCase();
      const paxType = item.paxType.toLowerCase();
      return category === expected || paxType === expected;
    });
  }, [services, pax]);

  const serviceName = customService
    ? customName.trim()
    : selectedPromotion
      ? selectedPromotion.headline || selectedPromotion.name
      : selectedService?.name || "";

  const balance = Math.max(total - paid, 0);
  const invalidPayment = paid > total;
  const paymentStatus =
    total <= 0
      ? "Sin monto"
      : paid <= 0
        ? "Pendiente de pago"
        : paid < total
          ? "Pago parcial"
          : "Pagado completo";

  function selectService(value: string) {
    if (value === "__CUSTOM__") {
      setCustomService(true);
      setServiceCode("");
      setPromotionCode("");
      setCustomName("");
      setDuration(60);
      setTotal(0);
      return;
    }

    setCustomService(false);
    setCustomName("");
    setPromotionCode("");
    setServiceCode(value);

    const item = services.find((service) => service.codeId === value);
    if (item) {
      setDuration(item.duration || 60);
      setTotal(item.price || 0);
    }
  }

  function selectPromotion(value: string) {
    setPromotionCode(value);
    setServiceCode("");
    setCustomService(false);
    setCustomName("");

    const item = promotions.find((promotion) => promotion.code === value);
    if (item) {
      setDuration(item.duration || 60);
      setTotal(pax === 2 ? item.price2p : item.price1p);
    }
  }

  function changePax(nextPax: number) {
    setPax(nextPax);
    setServiceCode("");
    setCustomService(false);
    setCustomName("");

    if (selectedPromotion) {
      setTotal(nextPax === 2 ? selectedPromotion.price2p : selectedPromotion.price1p);
    } else {
      setPromotionCode("");
      setDuration(60);
      setTotal(0);
    }

    if (nextPax === 1) setTerapista2("");
  }

  function validateCurrentStep() {
    if (step === 1) {
      if (!fecha || !hora || !sede) return "Selecciona fecha, hora y sede.";
    }

    if (step === 2) {
      if (!cliente.trim()) return "Ingresa el nombre del cliente.";
      if (whatsapp && !/^\d{9}$/.test(whatsapp)) {
        return "El WhatsApp debe tener 9 dígitos.";
      }
      if (dni && !/^\d{8}$/.test(dni)) {
        return "El DNI debe tener 8 dígitos.";
      }
    }

    if (step === 3) {
      if (!serviceName) return "Selecciona o escribe un servicio.";
      if (duration <= 0) return "Ingresa una duración válida.";
      if (total < 0) return "El precio no puede ser negativo.";
      if (!terapista1) return "Selecciona la terapista 1.";
      if (pax === 2 && !terapista2) return "Selecciona la terapista 2.";
      if (pax === 2 && terapista1 === terapista2) {
        return "Las dos personas no pueden tener la misma terapista.";
      }
    }

    if (step === 4) {
      if (invalidPayment) return "El monto pagado no puede superar el total.";
      if (paid > 0 && !metodo) return "Selecciona el método de pago.";
    }

    return "";
  }

  function next() {
    const message = validateCurrentStep();
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setStep((current) => Math.min(current + 1, 5));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previous() {
    setError("");
    setStep((current) => Math.max(current - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const steps = ["Operación", "Cliente", "Servicio", "Pago", "Confirmar"];

  return (
    <div className="wizardWrap">
      <div className="wizardProgress" aria-label={`Paso ${step} de 5`}>
        {steps.map((label, index) => {
          const number = index + 1;
          return (
            <div
              key={label}
              className={`wizardStep ${number === step ? "active" : ""} ${
                number < step ? "done" : ""
              }`}
            >
              <span>{number < step ? "✓" : number}</span>
              <small>{label}</small>
            </div>
          );
        })}
      </div>

      {error && <div className="wizardError">{error}</div>}

      <section className={`wizardPanel ${step === 1 ? "visible" : ""}`}>
        <h2>Paso 1 · Datos de la operación</h2>
        <p className="wizardIntro">Primero indica cuándo y en qué sede se realizará.</p>

        <div className="atencionGrid">
          <label className="atencionField">
            Tipo de registro
            <select name="tipo_registro" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="ATENCION">Atención de hoy / sin cita</option>
              <option value="RESERVA">Reserva futura</option>
            </select>
          </label>

          <label className="atencionField">
            Fecha
            <input name="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </label>

          <label className="atencionField">
            Hora
            <input name="hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} required />
            <small>Se carga automáticamente, pero puede modificarse.</small>
          </label>

          <label className="atencionField">
            Sede
            <select name="sede" value={sede} onChange={(e) => setSede(e.target.value)} required>
              <option value="">Selecciona una sede</option>
              {sedes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            {!sede && <small className="requiredHint">Obligatorio para evitar registros en una sede incorrecta.</small>}
          </label>
        </div>
      </section>

      <section className={`wizardPanel ${step === 2 ? "visible" : ""}`}>
        <h2>Paso 2 · Cliente</h2>
        <p className="wizardIntro">Registra los datos básicos de la persona que será atendida.</p>

        <div className="atencionGrid">
          <label className="atencionField atencionFieldWide">
            Cliente
            <input name="cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre del cliente" required />
          </label>

          <label className="atencionField">
            WhatsApp
            <input name="whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 9))} inputMode="numeric" placeholder="Ej. 987654321" />
          </label>

          <label className="atencionField">
            DNI
            <input name="dni" value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="Opcional" />
          </label>

          <label className="atencionField">
            N.º de personas
            <select name="n_pax" value={pax} onChange={(e) => changePax(Number(e.target.value))}>
              <option value={1}>1 persona</option>
              <option value={2}>2 personas</option>
            </select>
          </label>
        </div>
      </section>

      <section className={`wizardPanel ${step === 3 ? "visible" : ""}`}>
        <h2>Paso 3 · Servicio y terapistas</h2>
        <p className="wizardIntro">Selecciona una opción del catálogo o registra un servicio especial.</p>

        <div className="atencionGrid">
          <label className="atencionField atencionFieldWide">
            Servicio
            <select value={customService ? "__CUSTOM__" : serviceCode} onChange={(e) => selectService(e.target.value)} disabled={Boolean(promotionCode)}>
              <option value="">Selecciona un servicio</option>
              {filteredServices.map((item) => (
                <option key={item.codeId} value={item.codeId}>
                  {item.name} · {item.duration} min · {money(item.price)}
                </option>
              ))}
              <option value="__CUSTOM__">＋ Otro servicio / Servicio personalizado</option>
            </select>
          </label>

          <label className="atencionField">
            Promoción vigente
            <select value={promotionCode} onChange={(e) => selectPromotion(e.target.value)}>
              <option value="">Sin promoción</option>
              {promotions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} · {pax === 2 ? money(item.price2p) : money(item.price1p)}
                </option>
              ))}
            </select>
          </label>

          {customService && (
            <>
              <label className="atencionField atencionFieldWide">
                Nombre del nuevo servicio
                <input name="custom_service_name" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Ej. Masaje especial corporativo" />
              </label>

              {canSaveCatalog && (
                <label className="catalogCheckbox">
                  <input type="checkbox" name="save_to_catalog" value="1" checked={saveCatalog} onChange={(e) => setSaveCatalog(e.target.checked)} />
                  <span>Guardar permanentemente en el catálogo</span>
                </label>
              )}
            </>
          )}

          <label className="atencionField">
            Duración
            <input name="duracion_num" type="number" min="1" value={duration} onChange={(e) => setDuration(Number(e.target.value || 0))} />
            <input type="hidden" name="duracion" value={`${duration} min`} />
          </label>

          <label className="atencionField">
            Precio total
            <input name="monto_total" type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(Number(e.target.value || 0))} />
          </label>

          <label className="atencionField">
            Terapista 1
            <select name="terapista_1" value={terapista1} onChange={(e) => setTerapista1(e.target.value)}>
              <option value="">Selecciona una terapista</option>
              {terapistas.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label className="atencionField">
            Terapista 2
            <select name="terapista_2" value={terapista2} onChange={(e) => setTerapista2(e.target.value)} disabled={pax < 2}>
              <option value="">{pax < 2 ? "No aplica" : "Selecciona una terapista"}</option>
              {terapistas.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <input type="hidden" name="servicio" value={serviceName} />
        <input type="hidden" name="service_code" value={selectedService?.codeId || ""} />
        <input type="hidden" name="promo_code" value={selectedPromotion?.code || ""} />
        <input type="hidden" name="custom_service" value={customService ? "1" : ""} />

        {selectedPromotion?.includes && (
          <div className="promoDetail">
            <strong>{selectedPromotion.name}</strong>
            <span>{selectedPromotion.includes}</span>
          </div>
        )}
      </section>

      <section className={`wizardPanel ${step === 4 ? "visible" : ""}`}>
        <h2>Paso 4 · Pago y comprobante</h2>
        <p className="wizardIntro">Registra el pago realizado y la situación del comprobante.</p>

        <div className="atencionGrid">
          <label className="atencionField">
            Monto total
            <input value={total} readOnly />
          </label>

          <label className="atencionField">
            Monto pagado / adelanto
            <input name="monto_pagado" type="number" step="0.01" min="0" value={paid} onChange={(e) => setPaid(Number(e.target.value || 0))} />
          </label>

          <label className="atencionField">
            Método de pago
            <select name="metodo_pago" value={metodo} onChange={(e) => setMetodo(e.target.value)} disabled={paid <= 0}>
              <option value="">{paid <= 0 ? "Sin pago" : "Selecciona método"}</option>
              {metodos.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label className="atencionField">
            Estado boleta
            <select name="estado_boleta" value={estadoBoleta} onChange={(e) => setEstadoBoleta(e.target.value)}>
              {estadosBoleta.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label className="atencionField">
            Número boleta/factura
            <input name="numero_boleta" value={numeroBoleta} onChange={(e) => setNumeroBoleta(e.target.value)} placeholder="Opcional" />
          </label>

          <label className="atencionField">
            Responsable
            <select name="responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              {responsables.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>

          <label className="atencionField atencionFieldWide">
            Observación
            <textarea name="observacion" rows={3} value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Nota interna opcional" />
          </label>
        </div>

        <div className={`paymentSummary ${invalidPayment ? "error" : balance === 0 && total > 0 ? "paid" : ""}`}>
          <div><span>Total</span><strong>{money(total)}</strong></div>
          <div><span>Pagado</span><strong>{money(paid)}</strong></div>
          <div><span>Saldo pendiente</span><strong>{invalidPayment ? "Revisar monto" : money(balance)}</strong></div>
          <div><span>Estado del pago</span><strong>{paymentStatus}</strong></div>
        </div>

        <input type="hidden" name="estado_pago" value={paymentStatus} />
      </section>

      <section className={`wizardPanel ${step === 5 ? "visible" : ""}`}>
        <h2>Paso 5 · Revisa antes de guardar</h2>
        <p className="wizardIntro">Confirma que la sede, hora, servicio y montos sean correctos.</p>

        <div className="reviewGrid">
          <div><span>Tipo</span><strong>{tipo === "RESERVA" ? "Reserva futura" : "Atención de hoy"}</strong></div>
          <div><span>Fecha y hora</span><strong>{fecha} · {hora}</strong></div>
          <div className="reviewImportant"><span>Sede</span><strong>{sede}</strong></div>
          <div><span>Cliente</span><strong>{cliente}</strong></div>
          <div><span>WhatsApp</span><strong>{whatsapp || "No registrado"}</strong></div>
          <div><span>Personas</span><strong>{pax}</strong></div>
          <div className="reviewWide"><span>Servicio</span><strong>{serviceName}</strong></div>
          <div><span>Duración</span><strong>{duration} min</strong></div>
          <div><span>Terapista 1</span><strong>{terapista1}</strong></div>
          {pax === 2 && <div><span>Terapista 2</span><strong>{terapista2}</strong></div>}
          <div><span>Total</span><strong>{money(total)}</strong></div>
          <div><span>Pagado</span><strong>{money(paid)}</strong></div>
          <div className={balance > 0 ? "reviewPending" : ""}><span>Pago pendiente</span><strong>{money(balance)}</strong></div>
          <div className={balance > 0 ? "reviewPending" : "reviewImportant"}><span>Estado del pago</span><strong>{paymentStatus}</strong></div>
        </div>

        {customService && (
          <div className="customServiceNotice">
            Este es un servicio personalizado.
            {saveCatalog && canSaveCatalog
              ? " También se guardará en el catálogo permanente."
              : " Solo se utilizará en esta atención."}
          </div>
        )}
      </section>

      <div className="wizardActions">
        {step > 1 ? (
          <button type="button" className="ghostButton" onClick={previous}>Anterior</button>
        ) : (
          <a className="ghostButton" href="/">Cancelar</a>
        )}

        {step < 5 ? (
          <button type="button" className="primaryButton" onClick={next}>Siguiente</button>
        ) : (
          <button
            type="submit"
            name="confirmar_guardado"
            value="SI"
            className="primaryButton"
          >
            Confirmar y guardar
          </button>
        )}
      </div>
    </div>
  );
}
