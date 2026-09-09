import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clientePublicoInicial,
  evaluarEstadoToken,
  FICHA_CONTRATO_VERSION,
} from "../lib/fichaCitaDominio.ts";
import {
  FICHA_RECURRENTE_CONTRATO_VERSION,
  claveIntentosIdentificacion,
  construirFichaRecurrente,
  telefonoCoincideConClienteAsociado,
  type ClienteIdentificacionRow,
  type ComprobanteAnteriorRow,
  type FichaSaludAnteriorRow,
} from "../lib/fichaCitaRecurrente.ts";
import { secretoCajaValido } from "../lib/fichaCitaSeguridad.ts";

const cliente: ClienteIdentificacionRow = {
  cliente_id: "CLI-1",
  cliente: "Rosa Quispe",
  email: "rosa@example.com",
  whatsapp_e164: "+51987654321",
  cumple_dia: 14,
  cumple_mes: 3,
  consent_promos_en: "2026-01-10T10:00:00Z",
};

const citaAnterior = {
  reserva_id: "RES-ANTERIOR",
  updated_at: "2026-08-01T12:00:00Z",
};

function respuesta(overrides: Partial<Parameters<typeof construirFichaRecurrente>[0]> = {}) {
  return construirFichaRecurrente({
    cliente,
    ultimaCitaCompletada: citaAnterior,
    ultimaFichaSalud: null,
    ultimoComprobante: null,
    ...overrides,
  });
}

test("token vigente y WhatsApp asociado permiten identificar al cliente", () => {
  assert.equal(
    evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: "2030-09-09T10:00:00Z" }, Date.parse("2030-09-09T09:00:00Z")),
    "vigente"
  );
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "987654321", pais: "PE" }, cliente), true);
});

test("normaliza un teléfono peruano antes de compararlo", () => {
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "51 987 654 321", pais: "PE" }, cliente), true);
});

test("normaliza un teléfono extranjero antes de compararlo", () => {
  const extranjero = { ...cliente, whatsapp_e164: "+34612345678" };
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "612 34 56 78", pais: "ES" }, extranjero), true);
});

test("un teléfono incorrecto o un país inconsistente no coincide", () => {
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "986654321", pais: "PE" }, cliente), false);
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "+34612345678", pais: "PE" }, cliente), false);
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "987654321", pais: "PE" }, null), false);
});

test("distingue token inexistente", () => {
  assert.equal(evaluarEstadoToken(null), "token_no_existe");
});

test("distingue token vencido", () => {
  assert.equal(
    evaluarEstadoToken({ estado_ficha: "pendiente", token_expira: "2026-09-09T09:00:00Z" }, Date.parse("2026-09-09T09:00:01Z")),
    "token_vencido"
  );
});

test("distingue ficha ya completada", () => {
  assert.equal(
    evaluarEstadoToken({ estado_ficha: "completa", token_expira: "2030-09-09T09:00:00Z" }, Date.parse("2026-09-09T09:00:00Z")),
    "ficha_ya_completa"
  );
});

test("cliente sin cita anterior no se presenta como recurrente", () => {
  const result = respuesta({
    cliente: { ...cliente, email: null, cumple_dia: null, cumple_mes: null, consent_promos_en: null },
    ultimaCitaCompletada: null,
  });
  assert.equal(result.clienteRecurrente, false);
  assert.equal(result.saludAnterior, null);
  assert.equal(result.cliente.correo, null);
  assert.equal(result.cliente.cumple, null);
});

test("recupera nombre, correo y cumpleaños anteriores", () => {
  const result = respuesta();
  assert.equal(result.clienteRecurrente, true);
  assert.deepEqual(result.cliente, {
    nombre: "Rosa Quispe",
    correo: "rosa@example.com",
    cumple: { dia: 14, mes: 3 },
    promociones: { autorizoAnteriormente: true, requiereNuevaAceptacion: true },
  });
});

test("recupera la fotografía de salud de la última cita completada", () => {
  const salud: FichaSaludAnteriorRow = {
    reserva_id: citaAnterior.reserva_id,
    cliente_id: cliente.cliente_id,
    embarazo: false,
    presion: true,
    cirugia_reciente: false,
    alergias: "Látex",
    zonas_evitar: "Rodilla izquierda",
    notas: "Control médico",
  };
  assert.deepEqual(respuesta({ ultimaFichaSalud: salud }).saludAnterior, {
    disponible: true,
    sinCondicionesDeclaradas: false,
    embarazo: false,
    presion: true,
    cirugiaReciente: false,
    alergias: "Látex",
    zonasEvitar: "Rodilla izquierda",
    notas: "Control médico",
  });
});

test("cita anterior completa sin fila de salud significa sin condiciones declaradas", () => {
  assert.deepEqual(respuesta().saludAnterior, {
    disponible: true,
    sinCondicionesDeclaradas: true,
    embarazo: false,
    presion: false,
    cirugiaReciente: false,
    alergias: null,
    zonasEvitar: null,
    notas: null,
  });
});

test("recupera el último comprobante sin solicitarlo para la cita nueva", () => {
  const comprobante: ComprobanteAnteriorRow = {
    reserva_id: citaAnterior.reserva_id,
    cliente_id: cliente.cliente_id,
    tipo_comprobante: "FACTURA",
    tipo_documento: "RUC",
    numero_documento: "20123456789",
    razon_social: "Rosa Servicios SAC",
  };
  assert.deepEqual(respuesta({ ultimoComprobante: comprobante }).comprobanteAnterior, {
    tipoComprobante: "FACTURA",
    tipoDocumento: "RUC",
    numeroDocumento: "20123456789",
    razonSocial: "Rosa Servicios SAC",
    solicitarEnNuevaCita: false,
  });
});

test("la comparación queda aislada al cliente asociado y no acepta otro cliente", () => {
  const otroCliente = { ...cliente, cliente_id: "CLI-2", whatsapp_e164: "+14155552671" };
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "4155552671", pais: "US" }, cliente), false);
  assert.equal(telefonoCoincideConClienteAsociado({ crudo: "4155552671", pais: "US" }, otroCliente), true);
});

test("la identificación usa un contador de intentos aislado de GET y POST", () => {
  const token = "a".repeat(43);
  assert.equal(claveIntentosIdentificacion(token), `${token}:identificar`);
});

test("el límite bloquea después de 20 intentos durante 15 minutos", async () => {
  const shared = await readFile(new URL("../app/api/publico/ficha/_lib.ts", import.meta.url), "utf8");
  assert.match(shared, /export const MAX_INTENTOS = 20/);
  assert.match(shared, /export const BLOQUEO_MINUTOS = 15/);
  assert.match(shared, /intentos >= MAX_INTENTOS/);
  assert.match(shared, /Date\.now\(\) \+ BLOQUEO_MINUTOS \* 60 \* 1000/);
});

test("la autorización promocional anterior es informativa y exige nueva aceptación", () => {
  const promociones = respuesta().cliente.promociones;
  assert.deepEqual(promociones, { autorizoAnteriormente: true, requiereNuevaAceptacion: true });
});

test("secreto ausente o incorrecto no autentica el endpoint", () => {
  assert.equal(secretoCajaValido("correcto", ""), false);
  assert.equal(secretoCajaValido("incorrecto", "correcto"), false);
  assert.equal(secretoCajaValido("correcto", "correcto"), true);
});

test("el contrato de identificación está versionado en runtime", () => {
  const result = respuesta();
  assert.equal(FICHA_RECURRENTE_CONTRATO_VERSION, "ficha-recurrente-v1");
  assert.equal(result.contratoVersion, "ficha-recurrente-v1");
  assert.equal(JSON.parse(JSON.stringify(result)).contratoVersion, "ficha-recurrente-v1");
  assert.doesNotMatch(JSON.stringify(result), /whatsapp|telefono|\+51987654321/i);
});

test("el contrato existente ficha-cita-v1 no cambia", () => {
  assert.equal(FICHA_CONTRATO_VERSION, "ficha-cita-v1");
});

test("GET inicial conserva cliente compatible sin nombre ni correo", () => {
  const inicial = clientePublicoInicial("CLI-1");
  assert.deepEqual(inicial, {
    conocido: true,
    nombre: null,
    emailEnmascarado: null,
  });
  assert.doesNotMatch(JSON.stringify(inicial), /rosa|@|gmail|outlook/i);
});

test("GET inicial no consulta ni serializa datos personales del cliente", async () => {
  const route = await readFile(new URL("../app/api/publico/ficha/[token]/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /cargarCliente\(/);
  assert.doesNotMatch(route, /enmascararEmail/);
  assert.match(route, /cliente: clientePublicoInicial\(cita\.cliente_id\)/);
  assert.doesNotMatch(route, /cliente\?\.cliente|cliente\?\.email/);
});

test("el endpoint exige secreto, aplica límite y devuelve cabeceras privadas", async () => {
  const [route, shared] = await Promise.all([
    readFile(new URL("../app/api/publico/ficha/[token]/identificar/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/publico/ficha/_lib.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /autenticarApiPublica\(request\)/);
  assert.match(route, /checkRateLimit\(ip, claveIntentos\)/);
  assert.match(route, /registrarIntentoFallido\(ip, claveIntentos, intentosPrevios\)/);
  assert.match(route, /return jsonNoStore\(/);
  assert.match(shared, /"Cache-Control": "no-store"/);
  assert.match(shared, /"X-Robots-Tag": "noindex, nofollow, noarchive"/);
});

test("un fallo de identidad usa un error genérico y no devuelve datos", async () => {
  const route = await readFile(new URL("../app/api/publico/ficha/[token]/identificar/route.ts", import.meta.url), "utf8");
  assert.match(route, /identificacion_no_valida/);
  assert.match(route, /No se pudo verificar la identidad con los datos proporcionados/);
  assert.doesNotMatch(route, /teléfono pertenece|cliente ajeno|otro cliente/i);
});

test("identificar solo lee datos de negocio y no modifica registros históricos", async () => {
  const [route, shared, completeSql] = await Promise.all([
    readFile(new URL("../app/api/publico/ficha/[token]/identificar/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/publico/ficha/_lib.ts", import.meta.url), "utf8"),
    readFile(new URL("../sql/016_ficha_cita_hardening.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(route, /supabaseRpc|supabaseInsert|supabasePatch/);
  assert.match(shared, /select=cliente_id,whatsapp_e164/);
  assert.match(shared, /supabaseSelectWhere<ClienteIdentificacionRow>/);
  assert.match(shared, /supabaseSelectWhere<CitaAnteriorRow>/);
  assert.match(shared, /supabaseSelectWhere<FichaSaludAnteriorRow>/);
  assert.match(shared, /supabaseSelectWhere<ComprobanteAnteriorRow>/);
  assert.match(completeSql, /on conflict \(reserva_id\) do update set cliente_id = excluded\.cliente_id/);
});

test("las consultas de historial excluyen la reserva actual y no cruzan cliente_id", async () => {
  const shared = await readFile(new URL("../app/api/publico/ficha/_lib.ts", import.meta.url), "utf8");
  assert.match(shared, /`cliente_id=eq\.\$\{encodeURIComponent\(clienteId\)\}`/);
  assert.match(shared, /`reserva_id=neq\.\$\{encodeURIComponent\(reservaActualId\)\}`/);
  assert.match(shared, /"order=creado_en\.desc"/);
});
