import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

export const CANALES_FICHA = ["directo", "cuponidad", "bee"] as const;
export const FICHA_CONTRATO_VERSION = "ficha-cita-v1" as const;

/**
 * Mantiene ficha-cita-v1 compatible sin serializar PII antes de que el
 * endpoint /identificar confirme el WhatsApp asociado a la reserva.
 */
export function clientePublicoInicial(clienteId: string | null) {
  return {
    conocido: Boolean(clienteId),
    nombre: null,
    emailEnmascarado: null,
  };
}

export type CanalFicha = (typeof CANALES_FICHA)[number];

export type ReglaAdelantoInput = {
  canal: CanalFicha;
  personas: number;
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
  if (personas >= 2) return redondearDinero(total * 0.5);
  return redondearDinero(Math.min(10, total));
}

export type ComponentePersonalizado = {
  tipo: "catalogo" | "manual";
  codigo?: string;
  nombre: string;
  precio: number;
  duracion_min: number;
};
export type PersonaPersonalizada = { persona: number; componentes: ComponentePersonalizado[] };

/** Economía y duración de una atención presencial no catalogada como paquete. */
export function calcularAtencionPersonalizada(input: {
  personas: number;
  modalidad: "simultanea" | "consecutiva";
  componentes: PersonaPersonalizada[];
  precioFinal?: number | null;
  motivoAjuste?: string | null;
  confirmaDisponibilidad: boolean;
}) {
  if (!Number.isInteger(input.personas) || input.personas < 1 || input.personas > 5) return { ok: false as const, error: "La atención personalizada admite entre 1 y 5 personas." };
  if (!input.confirmaDisponibilidad) return { ok: false as const, error: "Confirma disponibilidad de cabinas y terapistas." };
  if (input.componentes.length !== input.personas || input.componentes.some((p, i) => p.persona !== i + 1 || !p.componentes.length)) return { ok: false as const, error: "Cada persona requiere al menos un componente." };
  const duraciones = input.componentes.map((p) => p.componentes.reduce((sum, c) => sum + c.duracion_min, 0));
  if (input.componentes.some((p) => p.componentes.some((c) => !c.nombre.trim() || !Number.isInteger(c.duracion_min) || c.duracion_min <= 0 || !Number.isFinite(c.precio) || c.precio <= 0))) return { ok: false as const, error: "Cada componente requiere nombre, duración y precio válidos." };
  const calculado = redondearDinero(input.componentes.flatMap((p) => p.componentes).reduce((sum, c) => sum + c.precio, 0));
  const final = redondearDinero(input.precioFinal ?? calculado);
  if (!Number.isFinite(final) || final <= 0) return { ok: false as const, error: "El precio final acordado debe ser válido." };
  const diferencia = redondearDinero(final - calculado);
  if (diferencia !== 0 && !input.motivoAjuste?.trim()) return { ok: false as const, error: "El ajuste de precio requiere un motivo." };
  const duracionMin = input.modalidad === "simultanea" ? Math.max(...duraciones) : duraciones.reduce((a, b) => a + b, 0);
  return { ok: true as const, precioCalculado: calculado, precioFinal: final, diferencia, duracionMin, adelantoRequerido: calcularAdelantoRequerido({ canal: "directo", personas: input.personas, montoTotal: final }), componentes: input.componentes };
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

export function validarPagoPreparacion(input: {
  montoPagado: number;
  adelantoRequerido: number;
  total: number;
  metodoPago: string;
  numeroOperacion: string;
  metodosPermitidos: readonly string[];
}) {
  const monto = redondearDinero(input.montoPagado);
  const adelanto = redondearDinero(input.adelantoRequerido);
  const total = redondearDinero(input.total);
  const metodo = input.metodoPago.trim().toUpperCase();
  const permitidos = new Set(
    input.metodosPermitidos.map((item) => item.trim().toUpperCase()).filter(Boolean)
  );

  if (!Number.isFinite(input.montoPagado) || monto < 0) {
    return "El monto pagado no puede ser negativo.";
  }
  if (!Number.isFinite(input.total) || total <= 0 || monto > total) {
    return "El monto pagado no puede superar el total de la cita.";
  }
  if (monto + 0.00001 < adelanto) {
    return `Registra al menos S/${adelanto.toFixed(2)} antes de generar el enlace.`;
  }
  if (monto > 0 && !metodo) {
    return "El método de pago es obligatorio.";
  }
  if (monto > 0 && !permitidos.has(metodo)) {
    return "El método de pago no está configurado o no está permitido.";
  }
  if (monto > 0 && metodo !== "EFECTIVO" && !input.numeroOperacion.trim()) {
    return "El número de operación es obligatorio para pagos no efectivos.";
  }
  return "";
}

function valorCatalogoPresente(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/** `price_pen` prevalece; `price` solo es respaldo cuando el primero falta. */
export function precioCatalogoActivo(pricePen: unknown, price: unknown) {
  const source = valorCatalogoPresente(pricePen) ? pricePen : price;
  const normalizado = String(source ?? "")
    .replace(/S\//gi, "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  if (!normalizado || normalizado === "." || normalizado === "-") return NaN;
  const parsed = Number(normalizado);
  return Number.isFinite(parsed) ? redondearDinero(parsed) : NaN;
}

/** El token puede vencer exactamente al terminar la atención, nunca antes. */
export function expiracionTokenFichaValida(input: {
  fecha: string;
  hora: string;
  duracionMin: number;
  tokenExpira: string;
}) {
  const inicio = new Date(`${input.fecha}T${input.hora}:00-05:00`).getTime();
  const expiracion = new Date(input.tokenExpira).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(expiracion) || !Number.isFinite(input.duracionMin) || input.duracionMin <= 0) {
    return false;
  }
  return expiracion >= inicio + input.duracionMin * 60_000;
}

export function calcularExpiracionFicha(fecha: string, hora: string, duracionMin: number) {
  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  return new Date(inicio.getTime() + duracionMin * 60_000).toISOString();
}

/**
 * Conserva la expiración contractual al final de la cita y evita crear un
 * token que ya nació vencido cuando se registra hoy una atención terminada.
 */
export function resolverExpiracionFichaVigente(
  fecha: string,
  hora: string,
  duracionMin: number,
  ahora = Date.now()
) {
  try {
    const tokenExpira = calcularExpiracionFicha(fecha, hora, duracionMin);
    const expiraEn = Date.parse(tokenExpira);
    if (!Number.isFinite(expiraEn) || expiraEn <= ahora) {
      return { ok: false as const };
    }
    return { ok: true as const, tokenExpira };
  } catch {
    return { ok: false as const };
  }
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

export function validarCodigoCuponPorCanal(canal: string, codigoCupon: string) {
  const codigo = codigoCupon.trim();
  const esConvenio = canal === "cuponidad" || canal === "bee";
  if (esConvenio && !codigo) return "Falta el código de cupón.";
  if (!esConvenio && codigo) return "Esta cita directa no admite código de cupón.";
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
