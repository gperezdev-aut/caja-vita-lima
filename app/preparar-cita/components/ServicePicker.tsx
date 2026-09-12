import { useMemo, useState } from "react";
import { categoryLabel } from "../prepararCitaWizard";
import type { Service } from "./types";

type Props = {
  services: Service[];
  value: string;
  label: string;
  onChange: (code: string) => void;
  autofocus?: boolean;
};

function money(value: number) {
  return `S/${value.toFixed(2).replace(/\.00$/, "")}`;
}
export function ServicePicker({ services, value, label, onChange, autofocus = false }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("TODOS");
  const categories = useMemo(() => Array.from(new Set(services.map((service) => service.category))), [services]);
  const filtered = services.filter((service) => {
    const matchesCategory = category === "TODOS" || service.category === category;
    const normalizedQuery = query.trim().toLocaleLowerCase("es-PE");
    return matchesCategory && (!normalizedQuery || service.name.toLocaleLowerCase("es-PE").includes(normalizedQuery));
  });

  return (
    <div className="servicePicker">
      <h3>{label}</h3>
      <label className="serviceSearch">
        <span>Buscar servicio</span>
        <input
          type="search"
          value={query}
          autoFocus={autofocus}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Escribe un nombre…"
        />
      </label>
      <div className="categoryChips" aria-label="Categorías">
        <button type="button" className={category === "TODOS" ? "active" : ""} onClick={() => setCategory("TODOS")}>Todos</button>
        {categories.map((item) => (
          <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)}>
            {categoryLabel(item)}
          </button>
        ))}
      </div>
      <div className="serviceCardList" role="radiogroup" aria-label={label}>
        {filtered.map((service) => (
          <button
            key={service.code}
            type="button"
            role="radio"
            aria-checked={value === service.code}
            className={value === service.code ? "selected" : ""}
            onClick={() => onChange(service.code)}
          >
            <span>
              <strong>{service.name}</strong>
              <small>{categoryLabel(service.category)}</small>
            </span>
            <b>{service.duration} min · {money(service.price)}</b>
          </button>
        ))}
        {!filtered.length && <p className="emptyServices">No hay servicios que coincidan con la búsqueda.</p>}
      </div>
    </div>
  );
}
