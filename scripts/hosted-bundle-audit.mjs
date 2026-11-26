/** Integration test: import the newly generated release, never repository code. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { prepareHostedScanner } from "./prepare-hosted-scanner.mjs";
import { checkHostedConfig } from "./check-hosted-config.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(
  root,
  ".scanner-private",
  "bundle-audit-" + randomUUID(),
);
const staging = fs.mkdtempSync(
  path.join(os.tmpdir(), "scanner-backend-stage-"),
);
const release = path.join(staging, "backend");
try {
  prepareHostedScanner(output);
  fs.cpSync(output, release, { recursive: true });
  checkHostedConfig(release);
  if (release.startsWith(root + path.sep))
    throw Error("Deployment staging must be outside the website checkout");
  const python =
    process.env.SCANNER_PYTHON ||
    (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(
    python,
    ["-I", "-B", path.join(release, "verify_bundle.py")],
    { cwd: release, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      "Generated bundle import test failed. Install its pinned requirements or set SCANNER_PYTHON to that virtual environment's Python.",
    );
  console.log(
    "Isolated backend staging, explicit config and generated hosted-release import tests passed.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(staging, { recursive: true, force: true });
}
