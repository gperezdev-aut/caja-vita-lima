import assert from "node:assert/strict";
import test from "node:test";
import { displayText } from "../lib/displayText";

test("displayText repara acentos UTF-8 interpretados como Windows-1252", () => {
  assert.equal(displayText("BioenergÃ©tico"), "Bioenergético");
  assert.equal(displayText("Drenaje LinfÃ¡tico"), "Drenaje Linfático");
});

test("displayText repara emoji mojibake sin tocar Unicode válido", () => {
  assert.equal(displayText("ðŸŒ¿ Relax Vital"), "🌿 Relax Vital");
  assert.equal(displayText("âœ¨ Glow Facial"), "✨ Glow Facial");
  assert.equal(displayText("🌿 Relax Vital"), "🌿 Relax Vital");
});
