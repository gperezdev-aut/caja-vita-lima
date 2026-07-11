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
  metodos: string[];
  terapistas: string[];
  estadosBoleta: string[];
  responsables: string[];
};

function money(value: number) {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  }).format(value);
}

export function NuevaAtencionDynamicFields({
  services,
  promotions,
  metodos,
  terapistas,
  estadosBoleta,
  responsables,
}: Props) {
  const [pax, setPax] = useState(1);
  const [serviceCode, setServiceCode] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
  const [duration, setDuration] = useState(60);
  const [total, setTotal] = useState(0);
  const [paid, setPaid] = useState(0);

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

      if (pax === 2) {
        return category === "2p" || paxType === "2p";
      }

      return category === "1p" || paxType === "1p";
    });
  }, [services, pax]);

  const balance = Math.max(total - paid, 0);
  const invalidPayment = paid > total;

  function applyService(code: string) {
    setServiceCode(code);
    setPromotionCode("");

    const item = services.find((service) => service.codeId === code);
    if (!item) {
      setDuration(60);
      setTotal(0);
      return;
    }

    setDuration(item.duration || 60);
    setTotal(item.price || 0);
  }

  function applyPromotion(code: string) {
    setPromotionCode(code);
    setServiceCode("");

    const item = promotions.find((promotion) => promotion.code === code);
    if (!item) {
      setDuration(60);
      setTotal(0);
      return;
    }

    setDuration(item.duration || 60);
    setTotal(pax === 2 ? item.price2p : item.price1p);
  }

  function changePax(nextPax: number) {
    setPax(nextPax);
    setServiceCode("");

    if (selectedPromotion) {
      setTotal(nextPax === 2 ? selectedPromotion.price2p : selectedPromotion.price1p);
    } else {
      setPromotionCode("");
      setDuration(60);
      setTotal(0);
    }
  }

  const serviceName = selectedPromotion
    ? selectedPromotion.headline || selectedPromotion.name
    : selectedService?.name || "";

  return (
    <>
      <section className="atencionSection">
        <h2>Cliente</h2>
        <div className="atencionGrid">
          <label className="atencionField">
            Cliente
            <input name="cliente" placeholder="Nombre del cliente" required />
          </label>

          <label className="atencionField">
            WhatsApp
            <input
              name="whatsapp"
              inputMode="numeric"
              maxLength={9}
              placeholder="Ej. 987654321"
              pattern="[0-9]{9}"
              title="Ingresa 9 dígitos"
            />
          </label>

          <label className="atencionField">
            DNI
            <input
              name="dni"
              inputMode="numeric"
              maxLength={8}
              placeholder="Opcional"
              pattern="[0-9]{8}"
              title="El DNI debe tener 8 dígitos"
            />
          </label>

          <label className="atencionField">
            N.º de personas
            <select
              name="n_pax"
              value={pax}
              onChange={(event) => changePax(Number(event.target.value))}
            >
              <option value={1}>1 persona</option>
              <option value={2}>2 personas</option>
            </select>
          </label>
        </div>
      </section>

      <section className="atencionSection">
        <div className="atencionSectionTitle">
          <div>
            <h2>Servicio y terapistas</h2>
            <p>El precio y la duración se cargan desde el catálogo de Supabase.</p>
          </div>
        </div>

        <div className="atencionGrid">
          <label className="atencionField atencionFieldWide">
            Servicio
            <select
              value={serviceCode}
              onChange={(event) => applyService(event.target.value)}
              disabled={Boolean(promotionCode)}
            >
              <option value="">Selecciona un servicio</option>
              {filteredServices.map((item) => (
                <option key={item.codeId} value={item.codeId}>
                  {item.name} · {item.duration} min · {money(item.price)}
                </option>
              ))}
            </select>
          </label>

          <label className="atencionField">
            Promoción vigente
            <select
              value={promotionCode}
              onChange={(event) => applyPromotion(event.target.value)}
            >
              <option value="">Sin promoción</option>
              {promotions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} · {pax === 2 ? money(item.price2p) : money(item.price1p)}
                </option>
              ))}
            </select>
          </label>

          <label className="atencionField">
            Duración
            <input value={`${duration} min`} readOnly />
            <input type="hidden" name="duracion" value={`${duration} min`} />
          </label>

          <label className="atencionField">
            Terapista 1
            <select name="terapista_1">
              <option value="">Por asignar</option>
              {terapistas.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="atencionField">
            Terapista 2
            <select name="terapista_2" disabled={pax < 2}>
              <option value="">
                {pax < 2 ? "No aplica" : "Por asignar"}
              </option>
              {terapistas.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>

        <input type="hidden" name="servicio" value={serviceName} />
        <input type="hidden" name="service_code" value={selectedService?.codeId || ""} />
        <input type="hidden" name="promo_code" value={selectedPromotion?.code || ""} />

        {!serviceName && (
          <p className="atencionHint">Selecciona un servicio o una promoción para continuar.</p>
        )}

        {selectedPromotion?.includes && (
          <div className="promoDetail">
            <strong>{selectedPromotion.name}</strong>
            <span>{selectedPromotion.includes}</span>
          </div>
        )}
      </section>

      <section className="atencionSection">
        <h2>Pago y comprobante</h2>

        <div className="atencionGrid">
          <label className="atencionField">
            Monto total
            <input
              name="monto_total"
              type="number"
              step="0.01"
              min="0"
              value={total}
              onChange={(event) => setTotal(Number(event.target.value || 0))}
              required
            />
          </label>

          <label className="atencionField">
            Monto pagado / adelanto
            <input
              name="monto_pagado"
              type="number"
              step="0.01"
              min="0"
              value={paid}
              onChange={(event) => setPaid(Number(event.target.value || 0))}
              required
            />
          </label>

          <label className="atencionField">
            Método de pago
            <select name="metodo_pago" disabled={paid <= 0}>
              {paid <= 0 && <option value="">Sin pago</option>}
              {metodos.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="atencionField">
            Estado boleta
            <select name="estado_boleta" defaultValue="Pendiente">
              {estadosBoleta.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="atencionField">
            Número boleta/factura
            <input name="numero_boleta" placeholder="Opcional" />
          </label>

          <label className="atencionField">
            Responsable
            <select name="responsable" defaultValue="Gerald">
              {responsables.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>

        <div className={`paymentSummary ${invalidPayment ? "error" : balance === 0 && total > 0 ? "paid" : ""}`}>
          <div>
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <div>
            <span>Pagado</span>
            <strong>{money(paid)}</strong>
          </div>
          <div>
            <span>Saldo pendiente</span>
            <strong>{invalidPayment ? "Revisar monto" : money(balance)}</strong>
          </div>
        </div>

        {invalidPayment && (
          <p className="fieldError">El monto pagado no puede ser mayor que el monto total.</p>
        )}
      </section>
    </>
  );
}
