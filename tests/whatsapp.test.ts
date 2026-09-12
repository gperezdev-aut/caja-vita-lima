import assert from "node:assert/strict";
import test from "node:test";
import { whatsappHref } from "../lib/whatsapp.ts";

test("WhatsApp conserva números E.164 de Perú, EE. UU. y México", () => {
  assert.equal(whatsappHref("+51987654321"), "https://wa.me/51987654321");
  assert.equal(whatsappHref("+13055552671"), "https://wa.me/13055552671");
  assert.equal(whatsappHref("+525512345678"), "https://wa.me/525512345678");
});

test("WhatsApp mantiene compatibilidad con números nacionales peruanos", () => {
  assert.equal(whatsappHref("987 654 321"), "https://wa.me/51987654321");
});

test("WhatsApp rechaza valores inválidos o vacíos", () => {
  assert.equal(whatsappHref("123"), "");
  assert.equal(whatsappHref("no disponible"), "");
  assert.equal(whatsappHref(""), "");
  assert.equal(whatsappHref(null), "");
});

