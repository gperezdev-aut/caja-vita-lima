export const CANALES_FICHA = ["directo", "cuponidad", "bee"] as const;

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

const SERVICIOS_DOMICILIO: Record<CodigoDomicilio, { precio: number; duracionMin: number }> = {
  "DOM-1H": { precio: 120, duracionMin: 60 },
  "DOM-2H": { precio: 230, duracionMin: 120 },
};

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

/**
 * El catálogo es la fuente del servidor; estos valores estables detectan un
 * catálogo inconsistente antes de registrar una cita a domicilio.
 */
export function calcularCitaDomicilio(servicios: ServicioCalculado[]) {
  if (!servicios.length || servicios.length > 2 || servicios.some((servicio) => !esCodigoDomicilio(servicio.codigo))) {
    return { ok: false as const, error: "Domicilio requiere uno o dos servicios DOM válidos." };
  }

  for (const servicio of servicios) {
    const esperado = SERVICIOS_DOMICILIO[servicio.codigo as CodigoDomicilio];
    if (redondearDinero(servicio.precio) !== esperado.precio || servicio.duracion_min !== esperado.duracionMin) {
      return { ok: false as const, error: `El catálogo no coincide con la tarifa de ${servicio.codigo}.` };
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

const PREFIJOS_PAIS: Record<string, string> = {
  PE: "51", US: "1", CA: "1", MX: "52", CO: "57", CL: "56",
  AR: "54", BR: "55", EC: "593", BO: "591", VE: "58", ES: "34",
  GB: "44", DE: "49", FR: "33", IT: "39",
};

export type NormalizarTelefonoResultado =
  | { ok: true; e164: string; pais: string }
  | { ok: false };

export function normalizarTelefonoE164(
  crudo: string,
  pais: string
): NormalizarTelefonoResultado {
  const soloDigitos = crudo.replace(/\D/g, "");
  const paisNormalizado = pais.trim().toUpperCase();

  if (crudo.trim().startsWith("+")) {
    if (soloDigitos.length >= 8 && soloDigitos.length <= 15) {
      return { ok: true, e164: `+${soloDigitos}`, pais: paisNormalizado };
    }
    return { ok: false };
  }

  const prefijo = PREFIJOS_PAIS[paisNormalizado];
  if (!prefijo || soloDigitos.length < 6 || soloDigitos.length > 12) {
    return { ok: false };
  }

  return { ok: true, e164: `+${prefijo}${soloDigitos}`, pais: paisNormalizado };
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
