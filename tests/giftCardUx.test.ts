import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findGiftCardClients,
  findGiftCardServices,
} from "../lib/giftCardUx.ts";

const root = process.cwd();
const source = (path: string) => readFile(`${root}/${path}`, "utf8");

const clients = [
  { id: "CLI-1", name: "María Peña", whatsapp: "+51 987 654 321" },
  { id: "CLI-2", name: "José Núñez", whatsapp: "+51 912 345 678" },
  { id: "CLI-3", name: "Sandra Mejía", whatsapp: "+51 955 111 222" },
];

test("combobox encuentra compradores por nombre, acento y WhatsApp", () => {
  assert.deepEqual(
    findGiftCardClients(clients, "maria").results.map((item) => item.id),
    ["CLI-1"],
  );
  assert.deepEqual(
    findGiftCardClients(clients, "Núñez").results.map((item) => item.id),
    ["CLI-2"],
  );
  assert.deepEqual(
    findGiftCardClients(clients, "955111").results.map((item) => item.id),
    ["CLI-3"],
  );
});

test("combobox limita resultados sin impedir el ingreso manual", async () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    id: `CLI-${index}`,
    name: `Cliente ${index}`,
    whatsapp: `999000${index}`,
  }));
  const match = findGiftCardClients(many, "Cliente");
  const wizard = await source("app/gift-cards/GiftCardsModule.tsx");
  assert.equal(match.results.length, 8);
  assert.equal(match.total, 30);
  assert.doesNotMatch(wizard, /<datalist|list="gift-card-clients"/);
  assert.match(wizard, /role="combobox"/);
  assert.match(wizard, /ingresar el nombre\s+manualmente/);
  assert.match(wizard, /setBuyer\(client\.name\)/);
  assert.match(wizard, /setBuyerId\(client\.id\)/);
  assert.match(wizard, /setBuyerPhone\(client\.whatsapp\)/);
});

test("combobox espera dos caracteres y prioriza teléfono exacto, prefijo y parcial", () => {
  assert.equal(findGiftCardClients(clients, "m").ready, false);
  const ranked = findGiftCardClients(
    [
      { id: "PARCIAL", name: "Uno", whatsapp: "+51 991 987 654" },
      { id: "PREFIJO", name: "Dos", whatsapp: "987 654 000" },
      { id: "EXACTO", name: "Tres", whatsapp: "987654" },
    ],
    "987654",
  );
  assert.deepEqual(
    ranked.results.map((item) => item.id),
    ["EXACTO", "PREFIJO", "PARCIAL"],
  );
});

test("buscador limita y encuentra servicios por nombre, código y categoría", () => {
  const services = Array.from({ length: 12 }, (_, index) => ({
    code: `SVC_${String(index + 40).padStart(3, "0")}`,
    name: index === 5 ? "👑 Royale" : `Facial ${index}`,
    duration: 60,
    price: 100,
    category: index < 10 ? "FACIAL" : "BEAUTY",
  }));
  assert.equal(findGiftCardServices(services, "").results.length, 8);
  assert.equal(
    findGiftCardServices(services, "royale").results[0]?.code,
    "SVC_045",
  );
  assert.equal(
    findGiftCardServices(services, "SVC_045").results[0]?.name,
    "👑 Royale",
  );
  assert.equal(findGiftCardServices(services, "beauty").total, 2);
});

test("historial distingue WhatsApp de beneficiario y comprador", async () => {
  const page = await source("app/gift-cards/page.tsx");
  assert.match(page, /whatsapp_beneficiario=ilike/);
  assert.match(page, /whatsapp_comprador=ilike/);
  assert.match(page, /name="whatsapp_beneficiario"/);
  assert.match(page, /name="whatsapp_comprador"/);
});

test("Paso 3 conserva controles Safari legibles y acciones con safe-area", async () => {
  const [wizard, css] = await Promise.all([
    source("app/gift-cards/GiftCardsModule.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(wizard, /Número de operación/);
  assert.match(
    wizard,
    /disabled=\{!method \|\| method\.toUpperCase\(\) === "EFECTIVO"\}/,
  );
  assert.match(css, /giftCardFormGrid[^{]*input[\s\S]*?min-height:46px/);
  assert.match(css, /font-size:16px/);
  assert.match(css, /-webkit-appearance:none/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("tarjeta emitida conserva la jerarquía de acciones solicitada", async () => {
  const wizard = await source("app/gift-cards/GiftCardsModule.tsx");
  const success =
    wizard.match(
      /if \(state\.ok[\s\S]*?<section className="panel giftCardSuccess"[\s\S]*?<\/section>/,
    )?.[0] ?? "";
  const labels = [
    "Descargar Gift Card",
    "Ver Gift Card",
    "Compartir por WhatsApp",
    "Emitir otra",
  ];
  let previous = -1;
  for (const label of labels) {
    const position = success.indexOf(label);
    assert.ok(
      position > previous,
      `${label} debe respetar la prioridad visual`,
    );
    previous = position;
  }
});

test("los 50 servicios canónicos son activos, comerciales y no son componentes internos", async () => {
  const fixture = JSON.parse(
    await source("tests/fixtures/catalog-v1-web-4104385.contract.json"),
  );
  assert.equal(fixture.services.length, 50);
  assert.ok(
    fixture.services.every(
      (service: Record<string, unknown>) =>
        service.active === true && Number(service.price_pen) > 0,
    ),
  );
  assert.ok(
    fixture.services.every(
      (service: Record<string, unknown>) => service.component_eligible == null,
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      ["INDIVIDUAL", "PACKAGE_TWO", "HOME", "PROGRAM", "BEAUTY", "FACIAL"].map(
        (category) => [
          category,
          fixture.services.filter(
            (service: { category: string }) => service.category === category,
          ).length,
        ],
      ),
    ),
    {
      INDIVIDUAL: 23,
      PACKAGE_TWO: 14,
      HOME: 2,
      PROGRAM: 4,
      BEAUTY: 3,
      FACIAL: 4,
    },
  );
});
