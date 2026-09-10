import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el runner entrega todos los artefactos de Next al usuario nextjs", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const runner = dockerfile.split("FROM node:20-alpine AS runner")[1];

  assert.ok(runner, "Dockerfile debe tener una etapa runner");
  assert.match(runner, /addgroup --system --gid 1001 nodejs/);
  assert.match(runner, /adduser --system --uid 1001 nextjs/);
  assert.match(runner, /chown nextjs:nodejs \/app/);

  for (const artifact of ["package.json", "node_modules", ".next", "public"]) {
    const destination = artifact === "package.json" ? "./package.json" : `./${artifact}`;
    assert.match(
      runner,
      new RegExp(`COPY --chown=nextjs:nodejs --from=builder /app/${artifact.replace(".", "\\.")} ${destination.replace(".", "\\.")}`),
    );
  }

  assert.match(runner, /^USER nextjs$/m);
  assert.doesNotMatch(runner, /^USER root$/m);
  assert.match(runner, /CMD \["npm", "run", "start"/);
});
