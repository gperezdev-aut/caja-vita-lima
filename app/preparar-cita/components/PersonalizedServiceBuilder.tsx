import type { PersonaPersonalizada } from "@/lib/fichaCitaDominio";
import type { Service } from "./types";

type Props = {
  services: Service[];
  modalidad: "simultanea" | "consecutiva";
  componentes: PersonaPersonalizada[];
  onModalidad: (value: "simultanea" | "consecutiva") => void;
  onComponentes: (value: PersonaPersonalizada[]) => void;
};

function updateComponent(
  componentes: PersonaPersonalizada[],
  personIndex: number,
  componentIndex: number,
  patch: Partial<PersonaPersonalizada["componentes"][number]>,
) {
  const next = structuredClone(componentes);
  next[personIndex].componentes[componentIndex] = { ...next[personIndex].componentes[componentIndex], ...patch } as PersonaPersonalizada["componentes"][number];
  return next;
}
export function PersonalizedServiceBuilder({ services, modalidad, componentes, onModalidad, onComponentes }: Props) {
  return (
    <div className="personalizedBuilder">
      <fieldset className="modePicker">
        <legend>Modalidad</legend>
        <div>
          {(["simultanea", "consecutiva"] as const).map((item) => (
            <button key={item} type="button" className={modalidad === item ? "selected" : ""} onClick={() => onModalidad(item)}>
              {item === "simultanea" ? "Simultánea" : "Consecutiva"}
            </button>
          ))}
        </div>
      </fieldset>
      {componentes.map((person, personIndex) => (
        <section className="personalizedPerson" key={person.persona}>
          <h3>Persona {person.persona}</h3>
          {person.componentes.map((component, componentIndex) => (
            <div className="personalizedComponent" key={componentIndex}>
              <label className="atencionField">
                Componente
                <select
                  value={component.tipo === "catalogo" ? component.codigo : "manual"}
                  onChange={(event) => {
                    const code = event.target.value;
                    onComponentes(updateComponent(componentes, personIndex, componentIndex, code === "manual"
                      ? { tipo: "manual", nombre: "", duracion_min: 0, precio: 0, codigo: undefined }
                      : { tipo: "catalogo", codigo: code, nombre: "", duracion_min: 0, precio: 0 }));
                  }}
                >
                  <option value="">Selecciona</option>
                  {services.map((service) => <option key={service.code} value={service.code}>{service.name} · {service.duration} min · S/{service.price}</option>)}
                  <option value="manual">Componente manual</option>
                </select>
              </label>
              {component.tipo === "manual" && (
                <div className="manualComponentFields">
                  <label className="atencionField">Nombre<input value={component.nombre} onChange={(event) => onComponentes(updateComponent(componentes, personIndex, componentIndex, { nombre: event.target.value }))} /></label>
                  <label className="atencionField">Duración (min)<input inputMode="numeric" type="number" min="1" value={component.duracion_min || ""} onChange={(event) => onComponentes(updateComponent(componentes, personIndex, componentIndex, { duracion_min: Number(event.target.value) }))} /></label>
                  <label className="atencionField">Precio (S/)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={component.precio || ""} onChange={(event) => onComponentes(updateComponent(componentes, personIndex, componentIndex, { precio: Number(event.target.value) }))} /></label>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="ghostButton addComponentButton"
            onClick={() => {
              const next = structuredClone(componentes);
              next[personIndex].componentes.push({ tipo: "catalogo", codigo: "", nombre: "", precio: 0, duracion_min: 0 });
              onComponentes(next);
            }}
          >
            + Añadir componente
          </button>
        </section>
      ))}
    </div>
  );
}
