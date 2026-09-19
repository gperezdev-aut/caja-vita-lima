import type { AppointmentType } from "./types";

type Props = {
  value: AppointmentType | "";
  personas: number;
  onSelect: (value: AppointmentType) => void;
  onPersonas: (value: number) => void;
  allowed?: AppointmentType[];
  stepLabel?: string;
  intro?: string;
};

const choices: Array<{ value: AppointmentType; title: string; detail: string }> = [
  { value: "single", title: "1 persona", detail: "Atención presencial individual" },
  { value: "couple", title: "2 personas", detail: "Paquete o un servicio por persona" },
  { value: "home", title: "Domicilio", detail: "Servicios HOME del catálogo" },
  { value: "custom", title: "Atención personalizada", detail: "Combina componentes y precio acordado" },
  { value: "benefit", title: "Cupón / Beneficio", detail: "Cuponidad o Bee Beneficios · el cliente completa ficha y código" },
];

export function AppointmentTypeStep({ value, personas, onSelect, onPersonas, allowed, stepLabel = "Paso 2 de 6", intro = "Elige una opción para mostrar solo los servicios compatibles." }: Props) {
  return (
    <section className="wizardPanel visible prepararStepPanel" aria-labelledby="type-step-title">
      <p className="stepKicker">{stepLabel}</p>
      <h2 id="type-step-title">¿Qué tipo de cita es?</h2>
      <p className="wizardIntro">{intro}</p>
      <div className="appointmentTypeGrid" role="radiogroup" aria-label="Tipo de cita">
        {choices.filter((choice) => !allowed || allowed.includes(choice.value)).map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={value === choice.value}
            className={value === choice.value ? "selected" : ""}
            onClick={() => onSelect(choice.value)}
          >
            <strong>{choice.title}</strong>
            <span>{choice.detail}</span>
          </button>
        ))}
      </div>
      {(value === "custom" || value === "home") && (
        <fieldset className="peoplePicker">
          <legend>{value === "home" ? "Personas para la cita a domicilio" : "¿Para cuántas personas?"}</legend>
          <div>
            {(value === "home" ? [1, 2] : [1, 2, 3, 4, 5]).map((count) => (
              <button key={count} type="button" className={personas === count ? "selected" : ""} onClick={() => onPersonas(count)}>
                {count} persona{count === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}
