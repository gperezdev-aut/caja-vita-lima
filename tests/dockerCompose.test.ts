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

  assert.match(gitignore, /^\.env\.production\.backup-\*$/m);
  assert.match(guide, /BACKUP_DIR="\/opt\/backups\/caja-vita-lima"/);
  assert.match(guide, /install -d -m 700 "\$BACKUP_DIR"/);
  assert.match(guide, /\(\n  umask 077\n  cp \.env\.production "\$ENV_BACKUP"/);
  assert.doesNotMatch(guide, /^umask 077$/m);
  assert.match(guide, /ENV_BACKUP="\$BACKUP_DIR\/\.env\.production\.backup-\$DEPLOY_ID"/);
  assert.match(guide, /chmod 600 "\$ENV_BACKUP"/);
  assert.match(guide, /STATE_FILE="\$BACKUP_DIR\/deploy-\$DEPLOY_ID\.env"/);
  assert.match(guide, /PREVIOUS_CONTAINER_NAME=%q/);
  assert.match(guide, /ROLLBACK_CONTAINER_NAME=%q/);
  assert.match(guide, /ROLLBACK_TAG=%q/);
  assert.match(guide, /ENV_BACKUP=%q/);
  assert.match(guide, /chmod 600 "\$STATE_FILE"/);
  assert.match(guide, /docker tag caja-vita-lima:local "\$ROLLBACK_TAG"/);
  assert.match(guide, /docker compose --env-file \.env\.production build/);
  assert.match(guide, /docker compose --env-file \.env\.production up -d --no-build/);
  assert.doesNotMatch(guide, /up -d --build/);
  assert.match(guide, /docker stop "\$PREVIOUS_CONTAINER_NAME"/);
  assert.match(guide, /docker rename "\$PREVIOUS_CONTAINER_NAME" "\$ROLLBACK_CONTAINER_NAME"/);
  assert.match(guide, /docker compose --env-file \.env\.production stop caja-vita-lima \|\| true/);
  assert.match(guide, /docker compose --env-file \.env\.production rm -f caja-vita-lima \|\| true/);
  assert.match(guide, /install -m 600 "\$ENV_BACKUP" \.env\.production/);
  assert.match(guide, /docker rename "\$ROLLBACK_CONTAINER_NAME" "\$PREVIOUS_CONTAINER_NAME"/);
  assert.match(guide, /docker start "\$PREVIOUS_CONTAINER_NAME"/);
  assert.match(guide, /https:\/\/caja\.vitalimaspa\.com\/login/);
  assert.match(guide, /No eliminar el contenedor manual renombrado ni la etiqueta de rollback/);
});
