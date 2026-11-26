/** Integration test: import the newly generated release, never repository code. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { prepareHostedScanner } from "./prepare-hosted-scanner.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(
  root,
  ".scanner-private",
  "bundle-audit-" + randomUUID(),
);
try {
  prepareHostedScanner(output);
  const python =
    process.env.SCANNER_PYTHON ||
    (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(
    python,
    ["-I", "-B", path.join(output, "verify_bundle.py")],
    { cwd: output, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      "Generated bundle import test failed. Install its pinned requirements or set SCANNER_PYTHON to that virtual environment's Python.",
    );
  console.log("Fresh generated hosted-release integration test passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
