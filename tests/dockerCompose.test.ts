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

test("la guía transiciona el contenedor manual y conserva rollback persistente", async () => {
  const [guide, gitignore] = await Promise.all([
    readFile(new URL("../docs/despliegue-contabo.md", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);
  const normalizedGuide = guide.replace(/\r\n/g, "\n");

  assert.match(gitignore, /^\.env\.production\.backup-\*$/m);
  assert.match(normalizedGuide, /BACKUP_DIR="\/opt\/backups\/caja-vita-lima"/);
  assert.match(normalizedGuide, /install -d -m 700 "\$BACKUP_DIR"/);
  assert.match(normalizedGuide, /\(\n  umask 077\n  cp \.env\.production "\$ENV_BACKUP"/);
  assert.doesNotMatch(normalizedGuide, /^umask 077$/m);
  assert.match(normalizedGuide, /ENV_BACKUP="\$BACKUP_DIR\/\.env\.production\.backup-\$DEPLOY_ID"/);
  assert.match(normalizedGuide, /chmod 600 "\$ENV_BACKUP"/);
  assert.match(normalizedGuide, /STATE_FILE="\$BACKUP_DIR\/deploy-\$DEPLOY_ID\.env"/);
  assert.match(normalizedGuide, /PREVIOUS_CONTAINER_NAME=%q/);
  assert.match(normalizedGuide, /ROLLBACK_CONTAINER_NAME=%q/);
  assert.match(normalizedGuide, /ROLLBACK_TAG=%q/);
  assert.match(normalizedGuide, /ENV_BACKUP=%q/);
  assert.match(normalizedGuide, /chmod 600 "\$STATE_FILE"/);
  assert.match(normalizedGuide, /docker tag caja-vita-lima:local "\$ROLLBACK_TAG"/);
  assert.match(normalizedGuide, /docker compose --env-file \.env\.production build/);
  assert.match(normalizedGuide, /docker compose --env-file \.env\.production up -d --no-build/);
  assert.doesNotMatch(normalizedGuide, /up -d --build/);
  assert.match(normalizedGuide, /docker stop "\$PREVIOUS_CONTAINER_NAME"/);
  assert.match(normalizedGuide, /docker rename "\$PREVIOUS_CONTAINER_NAME" "\$ROLLBACK_CONTAINER_NAME"/);
  assert.match(normalizedGuide, /docker compose --env-file \.env\.production stop caja-vita-lima \|\| true/);
  assert.match(normalizedGuide, /docker compose --env-file \.env\.production rm -f caja-vita-lima \|\| true/);
  assert.match(normalizedGuide, /install -m 600 "\$ENV_BACKUP" \.env\.production/);
  assert.match(normalizedGuide, /docker rename "\$ROLLBACK_CONTAINER_NAME" "\$PREVIOUS_CONTAINER_NAME"/);
  assert.match(normalizedGuide, /docker start "\$PREVIOUS_CONTAINER_NAME"/);
  assert.match(normalizedGuide, /https:\/\/caja\.vitalimaspa\.com\/login/);
  assert.match(normalizedGuide, /No eliminar el contenedor manual renombrado ni la etiqueta de rollback/);
});
