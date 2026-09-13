import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();

async function source(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

test("ordena la navegación según la secuencia operativa", async () => {
  const auth = await source("lib/auth.ts");
  const navItems = auth.match(
    /const NAV_ITEMS: CajaNavItem\[\] = \[([\s\S]*?)\n\];/,
  )?.[1];

  assert.ok(navItems, "NAV_ITEMS debe seguir siendo la fuente central del menú");

  const labels = [...navItems.matchAll(/label: "([^"]+)"/g)].map(
    ([, label]) => label,
  );

  assert.deepEqual(labels, [
    "Dashboard",
    "Citas de hoy",
    "Preparar cita",
    "Nueva atención",
    "Clientes",
    "Registrar salida",
    "Comprobantes",
    "Cierre de caja",
    "Alertas",
  ]);
});

test("móvil y desktop comparten el orden y reservan Gift Cards sin activarlo", async () => {
  const [auth, sidebar, css] = await Promise.all([
    source("lib/auth.ts"),
    source("components/CajaSidebar.tsx"),
    source("app/globals.css"),
  ]);

  assert.equal(
    sidebar.match(/\{navItems\.map\(\(item\) => \(/g)?.length,
    2,
    "desktop y móvil deben renderizar la misma lista filtrada",
  );
  assert.match(
    auth,
    /Gift Cards ocupará esta posición cuando exista como módulo funcional\./,
  );
  assert.doesNotMatch(auth, /label: "Gift Cards"/);
  assert.match(
    css,
    /\.mobileMenuNav\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  );
  assert.match(css, /\.mobileMenuNav a\{min-width:0;min-height:44px/);
});
