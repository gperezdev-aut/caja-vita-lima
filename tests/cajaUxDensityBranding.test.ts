import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();

async function source(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

test("usa el logo oficial en login y navegación sin incrustar otra marca", async () => {
  const [sidebar, login, logo] = await Promise.all([
    source("components/CajaSidebar.tsx"),
    source("app/login/page.tsx"),
    readFile(`${root}/public/brand/logo-vita-lima-orange.png`),
  ]);

  assert.ok(logo.length > 1_000);
  assert.match(sidebar, /\/brand\/logo-vita-lima-orange\.png/g);
  assert.match(login, /\/brand\/logo-vita-lima-orange\.png/);
  assert.match(sidebar, /alt="Vita Lima Spa"/);
  assert.match(login, /alt="Vita Lima Spa"/);
});

test("mantiene targets táctiles y safe-area en la experiencia móvil", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /--control-height:\s*46px/);
  assert.match(css, /min-height:\s*var\(--control-height\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /overflow-x:\s*hidden/);
});

test("ofrece representaciones móviles para las tablas operativas", async () => {
  const paths = [
    "app/page.tsx",
    "app/clientes/page.tsx",
    "app/clientes/[cliente_id]/page.tsx",
    "app/registrar-salida/page.tsx",
    "app/cierre-caja/page.tsx",
  ];

  for (const path of paths) {
    const content = await source(path);
    assert.match(content, /desktopData/, `${path} conserva tabla desktop`);
    assert.match(content, /mobileRecordList/, `${path} ofrece resumen móvil`);
  }
});

test("las citas priorizan acciones y relegan IDs técnicos", async () => {
  const citas = await source("app/citas-hoy/page.tsx");

  assert.match(citas, />WhatsApp</);
  assert.match(citas, />\s*Ver cliente\s*</);
  assert.match(citas, /Continuar atención/);
  assert.match(citas, /<details className="technicalDetails">/);
});
