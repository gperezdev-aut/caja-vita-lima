import type { AppointmentType, Service } from "./components/types";

export const WIZARD_PROGRESS = ["Cliente", "Servicio", "Horario", "Pago", "Confirmar"] as const;

export function progressIndex(step: number) {
  if (step <= 0) return 0;
  if (step <= 2) return 1;
  return Math.min(step - 1, WIZARD_PROGRESS.length - 1);
}
export function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    INDIVIDUAL: "Masajes",
    PACKAGE_TWO: "Parejas",
    HOME: "Domicilio",
    BEAUTY: "Belleza",
    FACIAL: "Facial",
  };
  return labels[category] ?? category.replaceAll("_", " ").toLocaleLowerCase("es-PE").replace(/^./, (value) => value.toUpperCase());
}

export function servicesForType(services: Service[], type: AppointmentType) {
  if (type === "home") return services.filter((service) => service.selectionRule === "HOME_FLOW");
  if (type === "single") return services.filter((service) => service.selectionRule === "ONE_PERSON");
  if (type === "couple") return services.filter((service) => ["ONE_PERSON", "FIXED_TWO_PACKAGE"].includes(service.selectionRule));
  return [];
}

export function homeServicesForPeople(services: Service[], personas: 1 | 2) {
  return services.filter((service) =>
    service.selectionRule === "HOME_FLOW" &&
    personas >= service.peopleMin &&
    personas <= service.peopleMax
  );
}

export function reconcileHomeSelection(
  services: Service[],
  personas: 1 | 2,
  service1: string,
  service2: string,
) {
  const compatibleCodes = new Set(homeServicesForPeople(services, personas).map((service) => service.code));
  return {
    service1: compatibleCodes.has(service1) ? service1 : "",
    service2: personas === 2 && compatibleCodes.has(service2) ? service2 : "",
  };
}

export function appointmentTypeLabel(type: AppointmentType | "", personas: number) {
  if (type === "single") return "1 persona";
  if (type === "couple") return "2 personas";
  if (type === "home") return `Domicilio · ${personas} persona${personas === 1 ? "" : "s"}`;
  if (type === "custom") return `Personalizada · ${personas} persona${personas === 1 ? "" : "s"}`;
  return "Cita sin definir";
}

export function formatTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "p. m." : "a. m.";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00-05:00`);
  if (Number.isNaN(date.getTime())) return value;
  const text = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "short", timeZone: "America/Lima" }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
