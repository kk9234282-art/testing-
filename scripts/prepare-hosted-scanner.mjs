/** Produce an isolated, secret-free deployment directory; never deploy or log credentials. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const project = fileURLToPath(new URL("..", import.meta.url));
const files = [
  "__init__.py",
  "app.py",
  "backtest.py",
  "hosted.py",
  "indicators.py",
  "jobs.py",
  "market_data.py",
  "quality.py",
  "research.py",
  "schema.py",
  "storage.py",
  "structure.py",
  "tejhq.py",
  "validation.py",
  "version.py",
  "worker.py",
];
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
  fs.mkdirSync(path.join(output, "scanner_service"), { mode: 0o700 });
  const hashes = {};
  function write(name, data) {
    fs.writeFileSync(path.join(output, name), data, { mode: 0o600 });
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
    'import os\nos.environ.setdefault("SCANNER_JOB_MODE", "external")\nfrom scanner_service.hosted import create_hosted_app\napp = create_hosted_app()\n',
  );
  write(
    "vercel.json",
    JSON.stringify(
      {
        functions: { "app.py": { maxDuration: 300 } },
        crons: [{ path: "/api/structure/internal/eod", schedule: "0 2 * * *" }],
      },
      null,
      2,
    ) + "\n",
  );
  write(
    ".vercelignore",
    "*\n!app.py\n!requirements.txt\n!.python-version\n!vercel.json\n!scanner_service/\n" +
      files.map((file) => "!scanner_service/" + file).join("\n") +
      "\n",
  );
  fs.writeFileSync(
    path.join(output, "bundle-manifest.json"),
    JSON.stringify(
      {
        format: "scanner-hosted-bundle-v1",
        contains_market_data: false,
        deployed: false,
        hashes,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
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
