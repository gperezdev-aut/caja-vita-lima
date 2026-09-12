export type EstadoActualAtencion = "Reservado" | "En atención";

export function estadoCobroInicial() {
  return { pago: "0", metodo: "" };
}

export function calcularSaldoPosterior(pendiente: number, pago: number) {
  return Math.max(pendiente - (Number.isFinite(pago) ? pago : 0), 0);
}

export function etiquetaAccionAtencion(
  pago: number,
  pendiente: number,
  estadoActual: EstadoActualAtencion
) {
  if (Number.isFinite(pago) && pago === pendiente) return "Finalizar atención";
  return estadoActual === "En atención" ? "Continuar atención" : "Iniciar atención";
}

export function validarDatosPago(pago: number, metodo: string, numeroOperacion: string) {
  if (pago <= 0) return null;
  const metodoNormalizado = metodo.trim().toUpperCase();
  if (!metodoNormalizado) return "METODO_PAGO_REQUERIDO";
  if (metodoNormalizado !== "EFECTIVO" && !numeroOperacion.trim()) {
    return "NUMERO_OPERACION_REQUERIDO";
  }
  return null;
}
