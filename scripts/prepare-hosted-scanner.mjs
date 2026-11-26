/** Produce an isolated, secret-free deployment directory; never deploy or log credentials. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { checkHostedConfig } from "./check-hosted-config.mjs";
const project = fileURLToPath(new URL("..", import.meta.url));
// Copy the complete Python package, excluding tests, caches and data files.
const packageRoot = path.join(project, "scanner_service");
const files = fs
  .readdirSync(packageRoot)
  .filter(
    (file) =>
      file.endsWith(".py") &&
      fs.statSync(path.join(packageRoot, file)).isFile(),
  )
  .sort();
export function prepareHostedScanner(
  destination = ".scanner-private/hosted-release",
) {
  const privateRoot = path.join(project, ".scanner-private");
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(privateRoot).isSymbolicLink())
    throw Error("Private output root must not be a symlink.");
  if (
    !fs
      .realpathSync(privateRoot)
      .startsWith(fs.realpathSync(project) + path.sep)
  )
    throw Error("Private output root must stay inside this checkout.");
  const output = path.resolve(project, destination);
  if (!output.startsWith(privateRoot + path.sep) || fs.existsSync(output))
    throw Error(
      "Choose a new directory beneath .scanner-private; existing output is never overwritten.",
    );
  let parent = path.dirname(output);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const realParent = fs.realpathSync(parent);
  if (
    realParent !== fs.realpathSync(privateRoot) &&
    !realParent.startsWith(fs.realpathSync(privateRoot) + path.sep)
  )
    throw Error("Output must not escape through a symlink.");
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(output, "scanner_service"), { mode: 0o755 });
  fs.chmodSync(path.join(output, "scanner_service"), 0o755);
  const hashes = {};
  function write(name, data) {
    fs.writeFileSync(path.join(output, name), data, { mode: 0o644 });
    fs.chmodSync(path.join(output, name), 0o644);
    hashes[name] = createHash("sha256").update(data).digest("hex");
  }
  for (const file of files)
    write(
      "scanner_service/" + file,
      fs.readFileSync(path.join(project, "scanner_service", file)),
    );
  write(
    "requirements.txt",
    fs.readFileSync(path.join(project, "scanner_service/requirements.lock")),
  );
  write(".python-version", "3.12\n");
  write(
    "app.py",
    [
      "import os",
      "import sys",
      "from pathlib import Path",
      "",
      "# Vercel may load this file by absolute path from a different working directory.",
      "sys.path.insert(0, str(Path(__file__).resolve().parent))",
      'os.environ.setdefault("SCANNER_JOB_MODE", "external")',
      "from scanner_service.hosted import create_hosted_app",
      "app = create_hosted_app()",
      "",
    ].join("\n"),
  );
  write(
    "vercel.json",
    JSON.stringify(
      {
        framework: "fastapi",
        functions: {
          "app.py": { maxDuration: 300, includeFiles: "scanner_service/**" },
        },
        crons: [{ path: "/api/structure/internal/eod", schedule: "0 2 * * *" }],
      },
      null,
      2,
    ) + "\n",
  );
  // This folder already contains only generated code. Avoid negated wildcard
  // traversal, which can omit a directory before its children are examined.
  write(
    ".vercelignore",
    [
      ".env",
      ".env.*",
      ".vercel",
      ".venv",
      ".venv/**",
      "__pycache__",
      "**/__pycache__/**",
      "*.pyc",
      "**/*.pyc",
      "*.sqlite*",
      "**/*.sqlite*",
      "*.json",
      "!vercel.json",
      "*.sql",
      "*.dump",
      "*.csv",
      "*.parquet",
      "*.zip",
      ".scanner-private",
      "public",
      "dist",
      "imports",
      "bundle-manifest.json",
      "verify_bundle.py",
      "",
    ].join("\n"),
  );
  write(
    "verify_bundle.py",
    fs.readFileSync(path.join(project, "scripts/verify-hosted-bundle.py")),
  );
  fs.writeFileSync(
    path.join(output, "bundle-manifest.json"),
    JSON.stringify(
      {
        format: "scanner-hosted-bundle-v2",
        contains_market_data: false,
        deployed: false,
        hashes,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o644 },
  );
  checkHostedConfig(output);
  return {
    output,
    files: Object.keys(hashes).length,
    contains_market_data: false,
    deployed: false,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(prepareHostedScanner(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
