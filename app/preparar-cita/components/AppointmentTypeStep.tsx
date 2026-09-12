import type { AppointmentType } from "./types";

type Props = {
  value: AppointmentType | "";
  personas: number;
  onSelect: (value: AppointmentType) => void;
  onPersonas: (value: number) => void;
};

const choices: Array<{ value: AppointmentType; title: string; detail: string }> = [
  { value: "single", title: "1 persona", detail: "Atención presencial individual" },
  { value: "couple", title: "2 personas", detail: "Paquete o un servicio por persona" },
  { value: "home", title: "Domicilio", detail: "Servicios HOME del catálogo" },
  { value: "custom", title: "Atención personalizada", detail: "Combina componentes y precio acordado" },
];

export function AppointmentTypeStep({ value, personas, onSelect, onPersonas }: Props) {
  return (
    <section className="wizardPanel visible prepararStepPanel" aria-labelledby="type-step-title">
      <p className="stepKicker">Paso 2 de 6</p>
      <h2 id="type-step-title">¿Qué tipo de cita es?</h2>
      <p className="wizardIntro">Elige una opción para mostrar solo los servicios compatibles.</p>
      <div className="appointmentTypeGrid" role="radiogroup" aria-label="Tipo de cita">
        {choices.map((choice) => (
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
      {value === "custom" && (
        <fieldset className="peoplePicker">
          <legend>¿Para cuántas personas?</legend>
          <div>
            {[1, 2, 3, 4, 5].map((count) => (
              <button key={count} type="button" className={personas === count ? "selected" : ""} onClick={() => onPersonas(count)}>
                {count}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}
