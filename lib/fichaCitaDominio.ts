export const CANALES_FICHA = ["directo", "cuponidad", "bee"] as const;

export type CanalFicha = (typeof CANALES_FICHA)[number];

export type ReglaAdelantoInput = {
  canal: CanalFicha;
  personas: 1 | 2;
  montoTotal: number;
  esGiftCard?: boolean;
};

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
}: ReglaAdelantoInput) {
  const total = redondearDinero(Math.max(0, montoTotal));

  if (esConvenioPagoPosterior(canal)) return 0;
  if (esGiftCard) return total;
  if (personas === 2) return redondearDinero(total * 0.5);
  return redondearDinero(Math.min(10, total));
}

export function requiereConfirmacion(canal: CanalFicha) {
  return esConvenioPagoPosterior(canal);
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
