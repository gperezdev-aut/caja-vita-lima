/** Contrato de lectura; no contiene configuración ni credenciales. */
export const CATALOG_RELEASE_ID = "catalog-v1-web-4104385";
export const CATALOG_SERVICE_COUNT = 50;
export const CATALOG_CATEGORY_COUNTS = {
  INDIVIDUAL: 23,
  PACKAGE_TWO: 14,
  HOME: 2,
  PROGRAM: 4,
  BEAUTY: 3,
  FACIAL: 4,
} as const;

export type CatalogCategory = keyof typeof CATALOG_CATEGORY_COUNTS;
export type CanonicalService = {
  service_code: `SVC_${string}`;
  slug: string;
  name_es: string;
  name_en: string | null;
  included_es: string | null;
  included_en: string | null;
  category: CatalogCategory;
  commercial_group: string | null;
  modality: string;
  duration_min: number;
  people_rule_status: string;
  people_min: number;
  people_max: number;
  selection_rule: string;
  reservation_behavior: string;
  component_eligible: boolean | null;
  component_eligibility_status: "PENDING_REVIEW";
  active: true;
  price_pen: number;
  previous_price_pen: number | null;
  price_version: string | number;
  valid_from: string;
  valid_to: string | null;
  release_id: typeof CATALOG_RELEASE_ID;
  source_web_sha: string;
};

export const CATALOG_COLUMNS = [
  "service_code", "slug", "name_es", "name_en", "included_es", "included_en", "category", "commercial_group",
  "modality", "duration_min", "people_rule_status", "people_min", "people_max",
  "selection_rule", "reservation_behavior", "component_eligible",
  "component_eligibility_status", "active", "price_pen", "previous_price_pen",
  "price_version", "valid_from", "valid_to", "release_id", "source_web_sha",
] as const satisfies readonly (keyof CanonicalService)[];

const ERROR_MESSAGES = {
  CONFIGURATION: "La conexión secundaria del catálogo no está configurada correctamente.",
  CONNECTION: "No se pudo consultar el catálogo canónico. No se utilizaron precios legacy.",
  RESPONSE: "La respuesta del catálogo canónico no es válida.",
  COUNT: "El catálogo canónico debe contener exactamente 50 servicios, sin truncamiento.",
  RELEASE: "El release del catálogo no coincide con catalog-v1-web-4104385.",
  SERVICE: "El catálogo contiene un servicio con campos inválidos.",
  CODE: "El catálogo contiene códigos inválidos, duplicados o faltan SVC_008/SVC_009.",
  ACTIVE: "Todos los servicios del catálogo deben estar activos.",
  ECONOMICS: "Los precios y las duraciones del catálogo deben ser positivos.",
  CATEGORY: "La distribución de categorías del catálogo no coincide con la esperada.",
  PEOPLE: "Las reglas de personas del catálogo no coinciden con las esperadas.",
  COMPONENTS: "Todos los servicios deben conservar component_eligibility_status=PENDING_REVIEW.",
  VALIDITY: "Las fechas de vigencia del catálogo no son válidas.",
} as const;

export class CatalogError extends Error {
  readonly code: keyof typeof ERROR_MESSAGES;

  constructor(code: keyof typeof ERROR_MESSAGES) {
    super(ERROR_MESSAGES[code]);
    this.name = "CatalogError";
    this.code = code;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Fechas ISO de PostgREST: date o timestamp con zona explícita. */
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

export function validateCanonicalCatalog(payload: unknown): CanonicalService[] {
  if (!Array.isArray(payload)) throw new CatalogError("RESPONSE");
  if (payload.length !== CATALOG_SERVICE_COUNT) throw new CatalogError("COUNT");

  const codes = new Set<string>();
  const counts = Object.fromEntries(Object.keys(CATALOG_CATEGORY_COUNTS).map((key) => [key, 0]));
  const services = payload.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogError("SERVICE");
    const row = value as Record<string, unknown>;
    if (row.release_id !== CATALOG_RELEASE_ID) throw new CatalogError("RELEASE");
    if (row.active !== true) throw new CatalogError("ACTIVE");
    if (typeof row.service_code !== "string" || !/^SVC_\d{3}$/.test(row.service_code) || codes.has(row.service_code)) {
      throw new CatalogError("CODE");
    }
    codes.add(row.service_code);
    if (typeof row.category !== "string" || !Object.hasOwn(CATALOG_CATEGORY_COUNTS, row.category)) throw new CatalogError("CATEGORY");
    counts[row.category] += 1;
    for (const key of ["slug", "name_es", "modality", "people_rule_status", "selection_rule", "reservation_behavior", "source_web_sha"] as const) {
      if (!nonEmptyString(row[key])) throw new CatalogError("SERVICE");
    }
    for (const key of ["name_en", "included_es", "included_en", "commercial_group"] as const) {
      if (row[key] !== null && !nonEmptyString(row[key])) throw new CatalogError("SERVICE");
    }
    if (!(nonEmptyString(row.price_version) || (positiveNumber(row.price_version) && Number.isInteger(row.price_version)))) throw new CatalogError("SERVICE");
    if (!positiveNumber(row.price_pen) || !positiveNumber(row.duration_min) ||
        (row.previous_price_pen !== null && !positiveNumber(row.previous_price_pen))) throw new CatalogError("ECONOMICS");
    if (!positiveNumber(row.people_min) || !Number.isInteger(row.people_min) ||
        !positiveNumber(row.people_max) || !Number.isInteger(row.people_max) || row.people_min > row.people_max) throw new CatalogError("PEOPLE");
    if (row.category === "PACKAGE_TWO" && (row.people_min !== 2 || row.people_max !== 2)) throw new CatalogError("PEOPLE");
    if (["SVC_008", "SVC_009"].includes(row.service_code) && (row.people_min !== 1 || row.people_max !== 2)) throw new CatalogError("PEOPLE");
    if (row.component_eligibility_status !== "PENDING_REVIEW" ||
        (row.component_eligible !== null && typeof row.component_eligible !== "boolean")) throw new CatalogError("COMPONENTS");
    if (!validDate(row.valid_from) || (row.valid_to !== null &&
        (!validDate(row.valid_to) || Date.parse(row.valid_to) <= Date.parse(row.valid_from)))) throw new CatalogError("VALIDITY");

    // Proyección explícita: nunca propagar columnas adicionales de la respuesta.
    return Object.fromEntries(CATALOG_COLUMNS.map((key) => [key, row[key]])) as CanonicalService;
  });

  if (!codes.has("SVC_008") || !codes.has("SVC_009")) throw new CatalogError("CODE");
  for (const [category, expected] of Object.entries(CATALOG_CATEGORY_COUNTS)) {
    if (counts[category] !== expected) throw new CatalogError("CATEGORY");
  }
  return services;
}

export function summarizeCanonicalCatalog(services: CanonicalService[]) {
  return {
    release: services[0].release_id,
    total: services.length,
    categories: Object.fromEntries(Object.keys(CATALOG_CATEGORY_COUNTS).map((category) => [
      category, services.filter((service) => service.category === category).length,
    ])),
    // Se conservan todos los intervalos; no se inventa una fecha común al release.
    validity: Array.from(new Map(services.map((service) => [
      JSON.stringify([service.valid_from, service.valid_to]),
      { valid_from: service.valid_from, valid_to: service.valid_to },
    ])).values()),
  };
}
