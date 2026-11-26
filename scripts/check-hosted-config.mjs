/** Fail closed if the website's deployment config is used for the Python backend. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkHostedConfig(directory) {
  const root = path.resolve(directory);
  const configPath = path.join(root, "vercel.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const functions = Object.keys(config.functions || {});
  if (functions.length !== 1 || functions[0] !== "app.py") {
    throw Error(
      `Wrong backend config: expected only app.py; found ${functions.join(", ") || "no functions"}. Do not deploy with the website's vercel.json.`,
    );
  }
  for (const pattern of functions) {
    const file = path.resolve(root, pattern);
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    )
      throw Error(
        `Function pattern does not match a deployed file: ${pattern}`,
      );
  }
  if (
    config.framework !== "fastapi" ||
    config.buildCommand ||
    config.outputDirectory
  )
    throw Error(
      "The backend must use FastAPI, without the website's Vite build/output settings.",
    );
  if (config.functions["app.py"].includeFiles !== "scanner_service/**")
    throw Error("Python package inclusion is missing.");
  if (!fs.existsSync(path.join(root, "scanner_service", "__init__.py")))
    throw Error("Python package initialization is missing.");
  const rules = fs
    .readFileSync(path.join(root, ".vercelignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (
    !rules.includes(".venv") ||
    !rules.includes(".venv/**") ||
    rules.some((line) => line.startsWith("!") && line !== "!vercel.json")
  )
    throw Error("Local .venv exclusions are missing or overridden.");
  const appSource = fs.readFileSync(
    path.join(root, "scanner_service", "app.py"),
    "utf8",
  );
  const hostedSource = fs.readFileSync(
    path.join(root, "scanner_service", "hosted.py"),
    "utf8",
  );
  const routes = [
    "/api/structure/health",
    "/api/structure/datasets",
    "/api/structure/market-data/status",
    "/api/structure/import",
    "/api/structure/runs/{kind}",
    "/api/structure/runs/{run_id}",
    "/api/structure/runs/{run_id}/stocks/{security_id}",
  ];
  for (const route of routes)
    if (!appSource.includes(JSON.stringify(route)))
      throw Error(`Required scanner route is missing: ${route}`);
  const daily = "/api/structure/internal/eod";
  if (
    !hostedSource.includes(JSON.stringify(daily)) ||
    config.crons?.length !== 1 ||
    config.crons[0].path !== daily ||
    config.crons[0].schedule !== "0 2 * * *"
  )
    throw Error("The protected daily route/schedule is missing or changed.");
  return {
    configPath,
    framework: config.framework,
    functions,
    packageIncluded: true,
    localVenvExcluded: true,
    scannerRoutes: routes.length + 1,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(checkHostedConfig(process.argv[2] || "."), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
