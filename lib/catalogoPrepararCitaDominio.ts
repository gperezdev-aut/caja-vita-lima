export type CatalogoCitaServicio = {
  serviceCode: string;
  nameEs: string;
  durationMin: number;
  pricePen: number;
  category: string;
  commercialGroup: string | null;
  modality: string;
  peopleMin: number;
  peopleMax: number;
  selectionRule: string;
  reservationBehavior: string;
  priceVersion: string;
  validFrom: string;
  validTo: string | null;
  releaseId: string;
};

export type PoliticaHome = {
  scope: "DISTRICT" | "DEFAULT";
  districtCode: string | null;
  districtName: string | null;
  districtNormalized: string | null;
  pricingMode: "INCLUDED" | "FIXED" | "MANUAL_CONFIRMATION";
  feePen: number | null;
  requiresConfirmation: boolean;
  policyId: string;
  policySha256: string;
  releaseId: string;
};

type Row = Record<string, unknown>;

function requiredText(value: unknown) {
  return String(value ?? "").trim();
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normalizarDistrito(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function servicioEsHome(service: Pick<CatalogoCitaServicio, "category" | "modality">) {
  return service.category === "HOME" || service.modality === "HOME";
}

export function servicioEsCitaNormal(service: Pick<CatalogoCitaServicio, "reservationBehavior" | "selectionRule">) {
  return (
    (service.reservationBehavior === "APPOINTMENT" || service.reservationBehavior === "HOME_APPOINTMENT") &&
    ["ONE_PERSON", "FIXED_TWO_PACKAGE", "HOME_FLOW"].includes(service.selectionRule)
  );
}

export function servicioEsComponente(service: Pick<CatalogoCitaServicio, "reservationBehavior" | "selectionRule" | "category" | "modality">) {
  return service.selectionRule === "ONE_PERSON" && service.reservationBehavior === "APPOINTMENT" && !servicioEsHome(service);
}

export function validarSeleccionCita(personas: number, services: CatalogoCitaServicio[]) {
  if (personas !== 1 && personas !== 2) return { ok: false as const, error: "La cantidad de personas debe ser 1 o 2." };
  if (!services.length || services.some((service) => !servicioEsCitaNormal(service))) {
    return { ok: false as const, error: "La selección no corresponde a servicios reservables." };
  }
  const home = services.every(servicioEsHome);
  if (services.some(servicioEsHome) && !home) return { ok: false as const, error: "No se pueden mezclar servicios presenciales y HOME." };
  if (home) {
    if (services.length !== personas || services.some((service) => service.selectionRule !== "HOME_FLOW" || personas < service.peopleMin || personas > service.peopleMax)) {
      return { ok: false as const, error: "La selección HOME no coincide con la cantidad de personas." };
    }
    return { ok: true as const, tipoAtencion: "domicilio" as const };
  }
  if (personas === 1 && services.length === 1 && services[0]?.selectionRule === "ONE_PERSON") {
    return { ok: true as const, tipoAtencion: "sede" as const };
  }
  if (personas === 2 && services.length === 1 && services[0]?.selectionRule === "FIXED_TWO_PACKAGE") {
    return { ok: true as const, tipoAtencion: "sede" as const };
  }
  if (personas === 2 && services.length === 2 && services.every((service) => service.selectionRule === "ONE_PERSON")) {
    return { ok: true as const, tipoAtencion: "sede" as const };
  }
  return { ok: false as const, error: "Para dos personas elige un paquete fijo o un servicio individual para cada persona." };
}

export function resolverPoliticaHome(district: string, policies: PoliticaHome[]) {
  const normalized = normalizarDistrito(district);
  const policy = policies.find((item) => item.scope === "DISTRICT" && item.districtNormalized === normalized)
    ?? policies.find((item) => item.scope === "DEFAULT");
  if (!policy) return { ok: false as const, error: "La política HOME activa está incompleta." };
  if (policy.pricingMode === "MANUAL_CONFIRMATION") {
    return { ok: true as const, feePen: null, requiresConfirmation: true, policy };
  }
  if (!Number.isFinite(policy.feePen) || policy.feePen === null || policy.feePen < 0) {
    return { ok: false as const, error: "La tarifa HOME configurada no es válida." };
  }
  return { ok: true as const, feePen: policy.feePen, requiresConfirmation: policy.requiresConfirmation, policy };
}

export function calcularEconomiaHome(
  services: Array<Pick<CatalogoCitaServicio, "category" | "modality" | "pricePen">>,
  district: string,
  policies: PoliticaHome[]
) {
  if (!services.length || services.some((service) => !servicioEsHome(service))) {
    return { ok: false as const, error: "HOME requiere exclusivamente servicios canónicos HOME." };
  }
  const resolved = resolverPoliticaHome(district, policies);
  if (!resolved.ok) return { ok: false as const, error: resolved.error };
  const subtotal = Math.round(services.reduce((sum, service) => sum + service.pricePen, 0) * 100) / 100;
  if (resolved.feePen === null) {
    return { ok: true as const, subtotal, feePen: null, total: null, requiresConfirmation: true, policy: resolved.policy };
  }
  return {
    ok: true as const,
    subtotal,
    feePen: resolved.feePen,
    total: Math.round((subtotal + resolved.feePen) * 100) / 100,
    requiresConfirmation: resolved.requiresConfirmation,
    policy: resolved.policy,
  };
}

export function parsearSnapshotServicios(rows: Row[]) {
  const services = rows.map((row): CatalogoCitaServicio | null => {
    const service: CatalogoCitaServicio = {
      serviceCode: requiredText(row.service_code), nameEs: requiredText(row.name_es),
      durationMin: finiteNumber(row.duration_min), pricePen: finiteNumber(row.price_pen),
      category: requiredText(row.category), commercialGroup: row.commercial_group == null ? null : requiredText(row.commercial_group),
      modality: requiredText(row.modality), peopleMin: finiteNumber(row.people_min), peopleMax: finiteNumber(row.people_max),
      selectionRule: requiredText(row.selection_rule), reservationBehavior: requiredText(row.reservation_behavior),
      priceVersion: requiredText(row.price_version), validFrom: requiredText(row.valid_from),
      validTo: row.valid_to == null ? null : requiredText(row.valid_to), releaseId: requiredText(row.release_id),
    };
    const contractValid =
      (service.selectionRule === "ONE_PERSON" && service.reservationBehavior === "APPOINTMENT" && service.peopleMin === 1 && service.peopleMax === 1) ||
      (service.selectionRule === "FIXED_TWO_PACKAGE" && service.reservationBehavior === "APPOINTMENT" && service.peopleMin === 2 && service.peopleMax === 2) ||
      (service.selectionRule === "HOME_FLOW" && service.reservationBehavior === "HOME_APPOINTMENT" && servicioEsHome(service) && service.peopleMin === 1 && service.peopleMax === 2) ||
      (service.selectionRule === "PROGRAM_PURCHASE" && service.reservationBehavior === "PROGRAM_PURCHASE" && service.peopleMin === 1 && service.peopleMax === 1);
    if (!/^SVC_\d{3}$/.test(service.serviceCode) || !service.nameEs || !Number.isInteger(service.durationMin) || service.durationMin <= 0 || !Number.isFinite(service.pricePen) || service.pricePen <= 0 || !service.priceVersion || !service.validFrom || !service.releaseId || !contractValid) return null;
    return service;
  });
  const releaseIds = new Set(services.flatMap((service) => service ? [service.releaseId] : []));
  if (rows.length !== 50 || services.some((service) => !service) || releaseIds.size !== 1 || new Set(services.map((service) => service?.serviceCode)).size !== 50) {
    return { ok: false as const, error: "El snapshot activo no contiene exactamente 50 servicios canónicos válidos." };
  }
  return { ok: true as const, services: services as CatalogoCitaServicio[], releaseId: services[0]!.releaseId };
}

export function parsearPoliticasHome(rows: Row[], releaseId: string) {
  const policies = rows.map((row): PoliticaHome | null => {
    const scope = requiredText(row.scope);
    const pricingMode = requiredText(row.pricing_mode);
    const policy: PoliticaHome = {
      scope: scope as PoliticaHome["scope"], districtCode: row.district_code == null ? null : requiredText(row.district_code),
      districtName: row.district_name == null ? null : requiredText(row.district_name), districtNormalized: row.district_normalized == null ? null : requiredText(row.district_normalized),
      pricingMode: pricingMode as PoliticaHome["pricingMode"], feePen: row.fee_pen == null ? null : finiteNumber(row.fee_pen),
      requiresConfirmation: row.requires_confirmation === true, policyId: requiredText(row.policy_id), policySha256: requiredText(row.policy_sha256), releaseId: requiredText(row.release_id),
    };
    if (!["DISTRICT", "DEFAULT"].includes(scope) || !["INCLUDED", "FIXED", "MANUAL_CONFIRMATION"].includes(pricingMode) || policy.releaseId !== releaseId || !policy.policyId || !/^[0-9a-f]{64}$/.test(policy.policySha256)) return null;
    return policy;
  });
  if (rows.length !== 6 || policies.some((policy) => !policy) || policies.filter((policy) => policy?.scope === "DEFAULT").length !== 1) {
    return { ok: false as const, error: "La política HOME activa no contiene exactamente 6 reglas válidas." };
  }
  return { ok: true as const, policies: policies as PoliticaHome[] };
}
