import { normalizarTelefonoE164 } from "./fichaCitaDominio.ts";

export const FICHA_RECURRENTE_CONTRATO_VERSION = "ficha-recurrente-v1" as const;

export type ClienteIdentificacionRow = {
  cliente_id: string;
  cliente: string | null;
  email: string | null;
  whatsapp_e164: string | null;
  cumple_dia: number | null;
  cumple_mes: number | null;
  consent_promos_en: string | null;
};

export type CitaAnteriorRow = {
  reserva_id: string;
  updated_at: string | null;
};

export type FichaSaludAnteriorRow = {
  reserva_id: string;
  cliente_id: string;
  embarazo: boolean | null;
  presion: boolean | null;
  cirugia_reciente: boolean | null;
  alergias: string | null;
  zonas_evitar: string | null;
  notas: string | null;
};

export type ComprobanteAnteriorRow = {
  reserva_id: string;
  cliente_id: string;
  tipo_comprobante: "BOLETA" | "FACTURA";
  tipo_documento: "DNI" | "RUC";
  numero_documento: string;
  razon_social: string | null;
};

export type FichaRecurrenteResponse = {
  contratoVersion: typeof FICHA_RECURRENTE_CONTRATO_VERSION;
  clienteRecurrente: boolean;
  cliente: {
    nombre: string | null;
    correo: string | null;
    cumple: { dia: number; mes: number } | null;
    promociones: {
      autorizoAnteriormente: boolean;
      requiereNuevaAceptacion: true;
    };
  };
  saludAnterior: {
    disponible: true;
    sinCondicionesDeclaradas: boolean;
    embarazo: boolean;
    presion: boolean;
    cirugiaReciente: boolean;
    alergias: string | null;
    zonasEvitar: string | null;
    notas: string | null;
  } | null;
  comprobanteAnterior: {
    tipoComprobante: "BOLETA" | "FACTURA";
    tipoDocumento: "DNI" | "RUC";
    numeroDocumento: string;
    razonSocial: string | null;
    solicitarEnNuevaCita: false;
  } | null;
};

export function telefonoCoincideConClienteAsociado(
  telefono: { crudo: string; pais: string },
  cliente: Pick<ClienteIdentificacionRow, "whatsapp_e164"> | null
) {
  const normalizado = normalizarTelefonoE164(telefono.crudo, telefono.pais);
  return Boolean(
    normalizado.ok &&
      cliente?.whatsapp_e164 &&
      normalizado.e164 === cliente.whatsapp_e164
  );
}

function cumpleValido(cliente: ClienteIdentificacionRow) {
  const dia = cliente.cumple_dia;
  const mes = cliente.cumple_mes;
  return Number.isInteger(dia) && Number.isInteger(mes) && dia! >= 1 && dia! <= 31 && mes! >= 1 && mes! <= 12
    ? { dia: dia!, mes: mes! }
    : null;
}

/**
 * Construye una fotografía de lectura. Se prefiere la última fila de salud
 * disponible; si no existe pero sí hay una cita anterior completada, significa
 * "sin condiciones declaradas" según el contrato histórico ficha-cita-v1.
 */
export function construirFichaRecurrente(input: {
  cliente: ClienteIdentificacionRow;
  ultimaCitaCompletada: CitaAnteriorRow | null;
  ultimaFichaSalud: FichaSaludAnteriorRow | null;
  ultimoComprobante: ComprobanteAnteriorRow | null;
}): FichaRecurrenteResponse {
  const { cliente, ultimaCitaCompletada, ultimaFichaSalud, ultimoComprobante } = input;
  const clienteRecurrente = Boolean(
    ultimaCitaCompletada || ultimaFichaSalud || ultimoComprobante
  );
  const saludAnterior = ultimaFichaSalud
      ? {
          disponible: true as const,
          sinCondicionesDeclaradas: false,
          embarazo: Boolean(ultimaFichaSalud.embarazo),
          presion: Boolean(ultimaFichaSalud.presion),
          cirugiaReciente: Boolean(ultimaFichaSalud.cirugia_reciente),
          alergias: ultimaFichaSalud.alergias,
          zonasEvitar: ultimaFichaSalud.zonas_evitar,
          notas: ultimaFichaSalud.notas,
        }
      : ultimaCitaCompletada
        ? {
          disponible: true as const,
          sinCondicionesDeclaradas: true,
          embarazo: false,
          presion: false,
          cirugiaReciente: false,
          alergias: null,
          zonasEvitar: null,
          notas: null,
        }
        : null;

  return {
    contratoVersion: FICHA_RECURRENTE_CONTRATO_VERSION,
    clienteRecurrente,
    cliente: {
      nombre: cliente.cliente,
      correo: cliente.email,
      cumple: cumpleValido(cliente),
      promociones: {
        autorizoAnteriormente: Boolean(cliente.consent_promos_en),
        requiereNuevaAceptacion: true,
      },
    },
    saludAnterior,
    comprobanteAnterior: ultimoComprobante
      ? {
          tipoComprobante: ultimoComprobante.tipo_comprobante,
          tipoDocumento: ultimoComprobante.tipo_documento,
          numeroDocumento: ultimoComprobante.numero_documento,
          razonSocial: ultimoComprobante.razon_social,
          solicitarEnNuevaCita: false,
        }
      : null,
  };
}

export function claveIntentosIdentificacion(token: string) {
  return `${token}:identificar`;
}
