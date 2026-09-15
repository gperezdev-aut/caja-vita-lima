import { redondearDinero } from "./fichaCitaDominio.ts";

export function calcularCoberturaGiftCard(saldoDisponible: number, totalCita: number) {
  return redondearDinero(Math.min(Math.max(saldoDisponible, 0), Math.max(totalCita, 0)));
}

export function calcularEfectivoMinimoAdicional(adelantoEstandar: number, coberturaGiftCard: number) {
  return redondearDinero(Math.max(adelantoEstandar - coberturaGiftCard, 0));
}

export function calcularSaldoRealPendiente(totalCita: number, pagosReales: number, coberturaGiftCard: number) {
  return redondearDinero(Math.max(totalCita - pagosReales - coberturaGiftCard, 0));
}
