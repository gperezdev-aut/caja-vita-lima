import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("usa el logo oficial en login y navegación sin incrustar otra marca", async () => {
  const [login, sidebar] = await Promise.all([
    source("app/login/page.tsx"),
    source("components/CajaSidebar.tsx"),
  ]);

  assert.match(login, /vita-lima-logo-oficial\.png/);
  assert.match(sidebar, /vita-lima-logo-oficial\.png/);
  assert.doesNotMatch(login, /<span[^>]*>\s*V\s*<\/span>/);
  assert.doesNotMatch(sidebar, /<span[^>]*>\s*V\s*<\/span>/);
});

test("el login evita redundancia y conserva el acceso interno", async () => {
  const login = await source("app/login/page.tsx");

  assert.match(login, /<h1>Caja<\/h1>/);
  assert.match(login, /Acceso interno para operación, reportes y gestión/);
  assert.doesNotMatch(login, /<p className="eyebrow">Caja operativa<\/p>/);
});

test("separa la acción de marca de los estados de éxito", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /--brand-primary:/);
  assert.match(css, /--brand-primary-hover:/);
  assert.match(css, /--brand-primary-soft:/);
  assert.match(css, /--green:/);
  assert.doesNotMatch(css, /--brand-primary:\s*#(?:0b|1f|18)[0-9a-f]{4}/i);
});

test("mantiene targets táctiles y safe-area en la experiencia móvil", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /@media\s*\(max-width:\s*599px\)/);
  assert.match(css, /min-height:\s*48px/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("ofrece representaciones móviles para las tablas operativas", async () => {
  const paths = [
    "app/citas-hoy/page.tsx",
    "app/clientes/page.tsx",
    "app/clientes/[cliente_id]/page.tsx",
    "app/registrar-salida/page.tsx",
    "app/cierre-caja/page.tsx",
  ];

  for (const path of paths) {
    const content = await source(path);
    if (path === "app/citas-hoy/page.tsx") {
      assert.match(content, /citasHoyDesktopTable/, `${path} conserva tabla desktop compacta`);
      assert.match(content, /citasHoyMobileList/, `${path} ofrece tarjetas móviles`);
    } else {
      assert.match(content, /desktopData/, `${path} conserva tabla desktop`);
      assert.match(content, /mobileRecordList/, `${path} ofrece resumen móvil`);
    }
  }
});

test("las citas priorizan acciones, contexto operativo y relegan IDs técnicos", async () => {
  const citas = await source("app/citas-hoy/page.tsx");

  assert.match(citas, />WhatsApp</);
  assert.match(citas, /included_es/);
  assert.match(citas, /citasHoyTableAction/);
  assert.match(citas, /Iniciar atención/);
  assert.match(citas, /Conciliar/);
  assert.match(citas, /showTechnical/);
  assert.match(citas, /<details className="technicalDetails">/);
  assert.doesNotMatch(citas, />\s*Ver cliente\s*</);
});
