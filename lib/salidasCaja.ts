export const NATURALEZAS_SALIDA = [
  "GASTO",
  "RETIRO_CAJA",
  "ENTREGA_PROPINA",
  "TRANSFERENCIA",
  "AJUSTE_CAJA",
] as const;

export type NaturalezaSalida = (typeof NATURALEZAS_SALIDA)[number];

export const METODOS_SALIDA = [
  "EFECTIVO",
  "YAPE",
  "PLIN",
  "IZIPAY POS",
  "BCP",
  "OTRO",
] as const;

export type MetodoSalida = (typeof METODOS_SALIDA)[number];

export const NATURALEZA_SALIDA_LABELS: Record<NaturalezaSalida, string> = {
  GASTO: "Gasto del negocio",
  RETIRO_CAJA: "Retiro / depósito de efectivo",
  ENTREGA_PROPINA: "Entrega de propina",
  TRANSFERENCIA: "Transferencia interna",
  AJUSTE_CAJA: "Ajuste de caja",
};

export function esNaturalezaSalida(value: string): value is NaturalezaSalida {
  return (NATURALEZAS_SALIDA as readonly string[]).includes(value);
}

export function normalizarMetodoSalida(value: unknown): MetodoSalida | "" {
  const metodo = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (!metodo) return "";
  if (metodo === "EFECTIVO") return "EFECTIVO";
  if (metodo.includes("YAPE")) return "YAPE";
  if (metodo.includes("PLIN")) return "PLIN";
  if (metodo.includes("IZIPAY") || metodo === "POS") return "IZIPAY POS";
  if (metodo.includes("BCP")) return "BCP";
  return "OTRO";
}

export function metodoForzadoPorNaturaleza(
  naturaleza: NaturalezaSalida
): MetodoSalida | null {
  if (naturaleza === "RETIRO_CAJA" || naturaleza === "AJUSTE_CAJA") {
    return "EFECTIVO";
  }
  return null;
}

export function afectaResultado(naturaleza: NaturalezaSalida) {
  return naturaleza === "GASTO";
}

export function afectaCajaFisica(
  naturaleza: NaturalezaSalida,
  metodo: MetodoSalida
) {
  if (naturaleza === "TRANSFERENCIA") return false;
  return metodo === "EFECTIVO";
}

export function validarNaturalezaMetodo(
  naturaleza: NaturalezaSalida,
  metodo: MetodoSalida
) {
  if (
    (naturaleza === "RETIRO_CAJA" || naturaleza === "AJUSTE_CAJA") &&
    metodo !== "EFECTIVO"
  ) {
    return "Los retiros y ajustes de caja deben registrarse como EFECTIVO.";
  }

  if (naturaleza === "TRANSFERENCIA" && metodo === "EFECTIVO") {
    return "Una transferencia interna no puede usar EFECTIVO. Usa Retiro / depósito de efectivo.";
  }

  return "";
}
