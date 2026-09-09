import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

export const CANALES_FICHA = ["directo", "cuponidad", "bee"] as const;
export const FICHA_CONTRATO_VERSION = "ficha-cita-v1" as const;

export type CanalFicha = (typeof CANALES_FICHA)[number];

export type ReglaAdelantoInput = {
  canal: CanalFicha;
  personas: 1 | 2;
  montoTotal: number;
  esGiftCard?: boolean;
  esDomicilio?: boolean;
};

export const CODIGOS_DOMICILIO = ["DOM-1H", "DOM-2H"] as const;
export type CodigoDomicilio = (typeof CODIGOS_DOMICILIO)[number];
export const COSTO_MOVILIDAD_DOMICILIO = 15;

export type ServicioCalculado = { codigo: string; precio: number; duracion_min: number };

export function esCodigoDomicilio(codigo: string): codigo is CodigoDomicilio {
  return (CODIGOS_DOMICILIO as readonly string[]).includes(codigo);
}

export function tipoAtencionDesdeServicios(codigos: string[]) {
  const domicilios = codigos.filter(esCodigoDomicilio).length;
  if (domicilios === 0) return "sede" as const;
  if (domicilios === codigos.length) return "domicilio" as const;
  return "mezclado" as const;
}

/** Los precios y duraciones llegan del catálogo activo validado por el servidor. */
export function calcularCitaDomicilio(servicios: ServicioCalculado[]) {
  if (!servicios.length || servicios.length > 2 || servicios.some((servicio) => !esCodigoDomicilio(servicio.codigo))) {
    return { ok: false as const, error: "Domicilio requiere uno o dos servicios DOM válidos." };
  }

  for (const servicio of servicios) {
    if (!Number.isFinite(servicio.precio) || servicio.precio <= 0 || !Number.isInteger(servicio.duracion_min) || servicio.duracion_min <= 0) {
      return { ok: false as const, error: `El catálogo no tiene precio o duración válidos para ${servicio.codigo}.` };
    }
  }

  const subtotalServicios = redondearDinero(servicios.reduce((total, servicio) => total + servicio.precio, 0));
  const total = redondearDinero(subtotalServicios + COSTO_MOVILIDAD_DOMICILIO);
  return {
    ok: true as const,
    subtotalServicios,
    movilidad: COSTO_MOVILIDAD_DOMICILIO,
    total,
    adelantoRequerido: redondearDinero(total * 0.5),
    duracionMin: Math.max(...servicios.map((servicio) => servicio.duracion_min)),
  };
}

export function coincideEconomiaDomicilio(
  calculo: Extract<ReturnType<typeof calcularCitaDomicilio>, { ok: true }>,
  total: number,
  movilidad: number
) {
  return redondearDinero(total) === calculo.total && redondearDinero(movilidad) === calculo.movilidad;
}

export function validarDatosDomicilio(
  datos: { sedeOperativa: string; distrito: string; direccion: string },
  sedesOperativas: string[]
) {
  if (!sedesOperativas.includes(datos.sedeOperativa)) return "La sede operativa no es válida.";
  if (!datos.distrito.trim()) return "El distrito del domicilio es obligatorio.";
  if (!datos.direccion.trim()) return "La dirección del domicilio es obligatoria.";
  return "";
}

export function describirAtencionDomicilio(datos: { distrito: string; direccion: string; referencia?: string | null }) {
  const referencia = datos.referencia?.trim();
  return ["Atención a domicilio", datos.distrito.trim(), datos.direccion.trim(), referencia ? `Referencia: ${referencia}` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function validarReglasComercialesDomicilio(datos: { canal: CanalFicha; esGiftCard: boolean; cuponPromocional: string }) {
  if (datos.canal !== "directo" || datos.esGiftCard || datos.cuponPromocional.trim()) {
    return "Las citas a domicilio solo admiten canal directo sin promociones ni gift cards.";
  }
  return "";
}

export function datosIcsDomicilio(datos: { servicio: string | null; distrito: string | null; direccion: string | null; referencia: string | null }) {
  return {
    resumen: "Atención a domicilio",
    ubicacion: [datos.distrito, datos.direccion].filter((item): item is string => Boolean(item?.trim())).join(", "),
    descripcion: [datos.servicio, datos.referencia ? `Referencia: ${datos.referencia}` : null]
      .filter((item): item is string => Boolean(item?.trim()))
      .join(" · "),
  };
}

export type EstadoFichaPublica = {
  estado_ficha: string | null;
  token_expira: string | null;
};

export type EstadoToken =
  | "vigente"
  | "token_no_existe"
  | "token_vencido"
  | "ficha_ya_completa";

export function esConvenioPagoPosterior(canal: CanalFicha) {
  return canal === "cuponidad" || canal === "bee";
}

/**
 * Cuponidad y Bee Beneficios son canales/convenios que pagan después y no
 * son cupones promocionales comunes. Un código de promoción del catálogo no
 * cambia `canal`, por lo que conserva esta política estándar.
 */
export function calcularAdelantoRequerido({
  canal,
  personas,
  montoTotal,
  esGiftCard = false,
  esDomicilio = false,
}: ReglaAdelantoInput) {
  const total = redondearDinero(Math.max(0, montoTotal));

  if (esDomicilio) return redondearDinero(total * 0.5);
  if (esConvenioPagoPosterior(canal)) return 0;
  if (esGiftCard) return total;
  if (personas === 2) return redondearDinero(total * 0.5);
  return redondearDinero(Math.min(10, total));
}

export function requiereConfirmacion(canal: CanalFicha, esDomicilio = false) {
  return esDomicilio || esConvenioPagoPosterior(canal);
}

export function redondearDinero(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function pagoHabilitaToken(
  montoPagado: number,
  adelantoRequerido: number
) {
  return (
    Number.isFinite(montoPagado) &&
    montoPagado >= 0 &&
    montoPagado + 0.00001 >= adelantoRequerido
  );
}

export type NormalizarTelefonoResultado =
  | { ok: true; e164: string; pais: string }
  | { ok: false };

export const PAISES_TELEFONO = getCountries();

export function normalizarTelefonoE164(
  crudo: string,
  pais: string
): NormalizarTelefonoResultado {
  const paisNormalizado = pais.trim().toUpperCase();
  if (!PAISES_TELEFONO.includes(paisNormalizado as CountryCode)) return { ok: false };

  const country = paisNormalizado as CountryCode;
  const limpio = crudo.trim();
  const digitos = limpio.replace(/\D/g, "");
  if (!digitos) return { ok: false };

  // Si llega un número internacional, el país real debe coincidir con el
  // seleccionado. También reconoce "51…" sin + antes de tratarlo como local,
  // evitando guardar +5151… por duplicar el prefijo peruano.
  const internacional = parsePhoneNumberFromString(
    limpio.startsWith("+") ? limpio : `+${digitos}`
  );
  if (internacional?.isValid()) {
    if (internacional.country === country) {
      return { ok: true, e164: internacional.number, pais: country };
    }
    if (limpio.startsWith("+")) return { ok: false };
  }

  const nacional = parsePhoneNumberFromString(limpio, country);
  if (!nacional?.isValid() || nacional.country !== country) return { ok: false };
  return { ok: true, e164: nacional.number, pais: country };
}

export type MotivoConfirmacion = "domicilio" | "convenio" | null;

export function estadoConfirmacionPublica(cita: {
  requiereConfirmacion: boolean;
  confirmadoEn?: string | null;
  tipoAtencion?: string | null;
  canal?: string | null;
}) {
  const confirmacionManual = cita.requiereConfirmacion && !cita.confirmadoEn;
  const motivoConfirmacion: MotivoConfirmacion = !confirmacionManual
    ? null
    : cita.tipoAtencion === "domicilio"
      ? "domicilio"
      : cita.canal === "cuponidad" || cita.canal === "bee"
        ? "convenio"
        : null;
  return { confirmacionManual, motivoConfirmacion };
}

export function pagoVisibleCliente(canal: string | null | undefined, montoTotal: number, adelanto: number) {
  if (canal === "cuponidad" || canal === "bee") {
    return {
      adelantoRecibido: 0,
      saldo: 0,
      leyenda: canal === "cuponidad" ? "Pago gestionado por Cuponidad" : "Pago gestionado por Bee Beneficios",
    };
  }
  return {
    adelantoRecibido: redondearDinero(adelanto),
    saldo: redondearDinero(Math.max(montoTotal - adelanto, 0)),
    leyenda: "Adelanto recibido",
  };
}

export function validarPreparacionMvp(input: {
  canal: string;
  esGiftCard: boolean;
  cuponPromocional: string;
}) {
  if (input.canal !== "directo" || input.esGiftCard || input.cuponPromocional.trim()) {
    return "En este lanzamiento, /preparar-cita solo admite citas directas sin promociones ni gift cards. Cuponidad, Bee, promociones y gift cards continúan en el proceso actual.";
  }
  return "";
}

export type ComprobanteValidado =
  | { ok: true; solicitado: false }
  | {
      ok: true;
      solicitado: true;
      tipoComprobante: "BOLETA" | "FACTURA";
      tipoDocumento: "DNI" | "RUC";
      numeroDocumento: string;
      razonSocial: string | null;
    }
  | { ok: false; error: string };

export function validarSolicitudComprobante(input: {
  requiere?: boolean;
  tipo?: "DNI" | "RUC";
  numero?: string;
  razonSocial?: string | null;
}): ComprobanteValidado {
  if (!input.requiere) return { ok: true, solicitado: false };
  const numero = input.numero?.trim() ?? "";
  if (input.tipo === "DNI" && /^\d{8}$/.test(numero)) {
    return { ok: true, solicitado: true, tipoComprobante: "BOLETA", tipoDocumento: "DNI", numeroDocumento: numero, razonSocial: null };
  }
  if (input.tipo === "RUC" && /^\d{11}$/.test(numero) && input.razonSocial?.trim()) {
    return { ok: true, solicitado: true, tipoComprobante: "FACTURA", tipoDocumento: "RUC", numeroDocumento: numero, razonSocial: input.razonSocial.trim() };
  }
  return { ok: false, error: input.tipo === "RUC" ? "El RUC requiere 11 dígitos y razón social." : "El DNI requiere 8 dígitos." };
}

export function preservarDatosCliente<T>(anterior: T | null | undefined, nuevo: T | null | undefined) {
  return nuevo == null || nuevo === "" ? anterior ?? null : nuevo;
}

export function resolverReintentoPreparacion(
  existente: { requestId: string; fingerprint: string; reservaId: string; token: string } | null,
  requestId: string,
  fingerprint: string
) {
  if (!existente) return { tipo: "crear" as const };
  if (existente.requestId === requestId && existente.fingerprint === fingerprint) {
    return { tipo: "reutilizar" as const, reservaId: existente.reservaId, token: existente.token };
  }
  return { tipo: "conflicto" as const };
}

export function resolverClientePorTelefono(
  clienteReservaId: string | null,
  clienteTelefonoId: string | null,
  clienteNuevoId: string
) {
  if (clienteReservaId && clienteTelefonoId && clienteReservaId !== clienteTelefonoId) {
    return { ok: false as const, error: "telefono_asociado_otro_cliente" as const };
  }
  return { ok: true as const, clienteId: clienteReservaId ?? clienteTelefonoId ?? clienteNuevoId };
}

export function identidadSincronizada(clienteId: string, nombre: string, whatsapp: string) {
  const identidad = { clienteId, nombre, whatsapp };
  return { cliente: identidad, cita: identidad, movimiento: identidad };
}

export function validarCatalogoSolicitado(
  codigos: string[],
  catalogo: Array<ServicioCalculado & { nombre: string }>
) {
  const servicios: Array<ServicioCalculado & { nombre: string }> = [];
  for (const codigo of codigos) {
    const coincidencias = catalogo.filter((item) => item.codigo === codigo);
    if (coincidencias.length !== 1) return { ok: false as const };
    const servicio = coincidencias[0];
    if (!servicio?.nombre.trim() || !Number.isFinite(servicio.precio) || servicio.precio <= 0 || !Number.isInteger(servicio.duracion_min) || servicio.duracion_min <= 0) {
      return { ok: false as const };
    }
    servicios.push(servicio);
  }
  return { ok: true as const, servicios };
}

function minutos(hora: string) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(hora);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function horarioDentroDeSede(
  hora: string,
  duracionMin: number,
  horaApertura: string,
  horaCierre: string
) {
  const inicio = minutos(hora);
  const apertura = minutos(horaApertura);
  const cierre = minutos(horaCierre);

  if (
    inicio === null ||
    apertura === null ||
    cierre === null ||
    !Number.isFinite(duracionMin) ||
    duracionMin <= 0
  ) {
    return false;
  }

  return inicio >= apertura && inicio + duracionMin <= cierre;
}

export function evaluarEstadoToken(
  cita: EstadoFichaPublica | null,
  ahora = Date.now()
): EstadoToken {
  if (!cita) return "token_no_existe";
  if (cita.token_expira) {
    const expiracion = new Date(cita.token_expira).getTime();
    if (!Number.isFinite(expiracion) || expiracion <= ahora) {
      return "token_vencido";
    }
  }

  if (cita.estado_ficha === "completa") return "ficha_ya_completa";
  return "vigente";
}

export function validarConfiguracionApiPublica(
  env: Record<string, string | undefined>,
  variables: readonly string[]
) {
  const faltantes: string[] = [];
  for (const variable of variables) {
    if (!env[variable]?.trim()) faltantes.push(variable);
  }

  return { ok: faltantes.length === 0, faltantes };
}
