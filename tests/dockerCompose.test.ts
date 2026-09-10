import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Docker Compose mantiene Caja aislada, protegida y verificable", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");

  assert.match(compose, /container_name: caja-vita-lima/);
  assert.match(compose, /image: caja-vita-lima:local/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /expose:\s*\n\s*- "3000"/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.match(compose, /external: true/);
  assert.match(compose, /name: n8n_default/);
  assert.match(compose, /aliases:\s*\n\s*- caja-vita-lima/);
  assert.match(compose, /NODE_ENV: production/);
  assert.match(compose, /NEXT_TELEMETRY_DISABLED: "1"/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:3000\/login/);
  assert.match(compose, /start_period: 45s/);
  assert.doesNotMatch(compose, /build:\s*\n(?:.|\n)*?args:/);
  assert.doesNotMatch(compose, /^\s*(volumes|mounts):/m);

  for (const variable of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CAJA_APP_PASSWORD",
    "CAJA_SESSION_SECRET",
    "CAJA_API_SECRET",
    "CAJA_POLITICA_CANCELACION_URL",
    "CAJA_WHATSAPP_NEGOCIO",
  ]) {
    assert.match(compose, new RegExp(`\\$\\{${variable}:\\?${variable} is required\\}`));
  }
});
