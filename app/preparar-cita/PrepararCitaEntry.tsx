"use client";

import { useState } from "react";
import type { PoliticaHome } from "@/lib/catalogoPrepararCitaDominio";
import { AppointmentTypeStep } from "./components/AppointmentTypeStep";
import type { AppointmentType, Service } from "./components/types";
import { PrepararCitaForm, type GiftCardAppointmentContext } from "./PrepararCitaForm";
import { PrepararConvenioForm } from "./PrepararConvenioForm";

type Props = {
  services: Service[];
  homePolicies: PoliticaHome[];
  sedes: { name: string; open: string; close: string }[];
  metodos: string[];
  countries: { code: string; name: string; callingCode: string }[];
  requestId: string;
  minDate: string;
  giftCard?: GiftCardAppointmentContext | null;
};

type StandardAppointmentType = Exclude<AppointmentType, "benefit">;

export function PrepararCitaEntry(props: Props) {
  const [selectedType, setSelectedType] = useState<AppointmentType | "">("");

  if (props.giftCard) {
    return <PrepararCitaForm {...props} />;
  }

  if (!selectedType) {
    return (
      <section className="atencionForm prepararWizard">
        <AppointmentTypeStep
          value=""
          personas={1}
          onSelect={setSelectedType}
          onPersonas={() => undefined}
          stepLabel="Antes de empezar"
          intro="Elige el tipo de cita. Cupón / Beneficio abre un flujo corto sin pedir datos ni pagos al operador."
        />
      </section>
    );
  }

  if (selectedType === "benefit") {
    return (
      <PrepararConvenioForm
        sedes={props.sedes}
        requestId={props.requestId}
        minDate={props.minDate}
        onBack={() => setSelectedType("")}
      />
    );
  }

  return (
    <PrepararCitaForm
      {...props}
      initialAppointmentType={selectedType as StandardAppointmentType}
    />
  );
}
