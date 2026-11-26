import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prepareHostedScanner } from "../scripts/prepare-hosted-scanner.mjs";
test("isolated hosted bundle has only pinned code/config, hashes and a daily protected target", () => {
  const output = path.resolve(
    ".scanner-private/bundle-test-" + crypto.randomUUID(),
  );
  try {
    const result = prepareHostedScanner(output);
    assert.equal(result.deployed, false);
    assert.equal(result.contains_market_data, false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(output, "bundle-manifest.json")),
    );
    for (const [file, hash] of Object.entries(manifest.hashes))
      assert.equal(
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(output, file)))
          .digest("hex"),
        hash,
      );
    assert.equal(
      fs.readFileSync(path.join(output, "requirements.txt"), "utf8"),
      fs.readFileSync("scanner_service/requirements.lock", "utf8"),
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(output, "vercel.json"))).crons,
      [{ path: "/api/structure/internal/eod", schedule: "0 2 * * *" }],
    );
    assert.equal(fs.existsSync(path.join(output, ".env.scanner")), false);
    assert.equal(fs.existsSync(path.join(output, "public")), false);
    assert.equal(
      fs.existsSync(path.join(output, "scanner_service/tests")),
      false,
    );
    assert.throws(() => prepareHostedScanner(output), /existing output/);
    assert.throws(() => prepareHostedScanner("public/not-allowed"), /beneath/);
    const rootEntries = fs.readdirSync(output);
    assert.equal(rootEntries.length, 8);
    const config = JSON.parse(
      fs.readFileSync(path.join(output, "vercel.json")),
    );
    assert.equal(config.functions["app.py"].includeFiles, "scanner_service/**");
    const originals = fs
      .readdirSync("scanner_service")
      .filter((file) => file.endsWith(".py"))
      .sort();
    assert.deepEqual(
      fs.readdirSync(path.join(output, "scanner_service")).sort(),
      originals,
    );
    assert.ok(
      fs.statSync(path.join(output, "scanner_service/__init__.py")).isFile(),
    );
    assert.ok(
      fs
        .readFileSync(path.join(output, "app.py"), "utf8")
        .includes("Path(__file__).resolve().parent"),
    );
    const ignore = fs.readFileSync(path.join(output, ".vercelignore"), "utf8");
    assert.ok(!ignore.split("\n").includes("*"));
    assert.ok(!ignore.includes("!scanner_service"));
    assert.ok(ignore.includes(".env.*"));
    assert.ok(fs.existsSync(path.join(output, "verify_bundle.py")));
    if (process.platform !== "win32") {
      assert.equal(
        fs.statSync(path.join(output, "scanner_service")).mode & 0o555,
        0o555,
      );
      for (const file of originals)
        assert.equal(
          fs.statSync(path.join(output, "scanner_service", file)).mode & 0o444,
          0o444,
        );
    }
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test("website function patterns match real website files and remain separate from backend", async () => {
  const { checkHostedConfig } = await import(
    "../scripts/check-hosted-config.mjs"
  );
  const website = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.ok(website.functions["api/quote/[symbol].js"]);
  for (const file of Object.keys(website.functions))
    assert.ok(fs.statSync(file).isFile(), file);
  assert.throws(
    () => checkHostedConfig("."),
    /Wrong backend config.*api\/quote/,
  );
});

test("backend rejects stale website config, absent functions, lost routes and venv inclusion", async () => {
  const { checkHostedConfig } = await import(
    "../scripts/check-hosted-config.mjs"
  );
  const output = path.resolve(
    ".scanner-private/config-test-" + crypto.randomUUID(),
  );
  try {
    prepareHostedScanner(output);
    assert.deepEqual(checkHostedConfig(output).functions, ["app.py"]);
    const configFile = path.join(output, "vercel.json");
    const good = fs.readFileSync(configFile);
    fs.copyFileSync("vercel.json", configFile);
    assert.throws(
      () => checkHostedConfig(output),
      /Wrong backend config.*api\/quote/,
    );
    fs.writeFileSync(configFile, good);
    const entry = path.join(output, "app.py");
    fs.renameSync(entry, entry + ".saved");
    assert.throws(() => checkHostedConfig(output), /ENOENT|deployed file/);
    fs.renameSync(entry + ".saved", entry);
    const routes = path.join(output, "scanner_service/app.py");
    const app = fs.readFileSync(routes);
    fs.writeFileSync(
      routes,
      app.toString().replace('"/api/structure/import"', '"/api/wrong"'),
    );
    assert.throws(() => checkHostedConfig(output), /Required scanner route/);
    fs.writeFileSync(routes, app);
    fs.appendFileSync(path.join(output, ".vercelignore"), "!.venv/**\n");
    assert.throws(() => checkHostedConfig(output), /venv exclusions/);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
