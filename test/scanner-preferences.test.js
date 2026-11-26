import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
// Compile this isolated browser model so tests also run on supported Node 20.
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/scanner/preferences.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const {
  PREFERENCE_FORMAT,
  defaultFilters,
  emptyLibrary,
  validatePreferences,
  validateFilters,
  parseLibrary,
  importBackup,
} = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const stock = {
  security_id: "S1",
  symbol: "PNB",
  name: "Example company",
  isin: "INE160A01022",
};
const pref = () => ({
  watchlist: [{ ...stock }],
  presets: [
    {
      name: "Leaders",
      filters: { ...defaultFilters(), minVolume: "1.5", minRs: "-2" },
    },
  ],
});
const backup = (preferences, scope = "sample") =>
  JSON.stringify({ format: PREFERENCE_FORMAT, scope, preferences });
test("preferences round trip retains filters, numeric strings and source separation", () => {
  const library = emptyLibrary();
  library.sample = pref();
  const result = parseLibrary(
    JSON.stringify({ format: PREFERENCE_FORMAT, ...library }),
  );
  assert.deepEqual(result.sample, library.sample);
  assert.deepEqual(result.private, { watchlist: [], presets: [] });
});
test("backup merge deduplicates stable IDs and rejects cross-source or conflicting presets atomically", () => {
  const current = pref();
  assert.deepEqual(importBackup(backup(pref()), "sample", current), current);
  assert.throws(
    () => importBackup(backup(pref()), "private", current),
    /different source/,
  );
  const conflict = pref();
  conflict.presets[0].filters.minVolume = "3";
  assert.throws(
    () => importBackup(backup(conflict), "sample", current),
    /conflict/,
  );
  assert.equal(current.presets[0].filters.minVolume, "1.5");
});
test("reject unknown approval/token fields, malformed identifiers, duplicate stocks and presets", () => {
  for (const field of ["token", "verified", "__proto__"]) {
    const p = pref();
    Object.defineProperty(p, field, { value: true, enumerable: true });
    assert.throws(() => validatePreferences(p), /Unknown/);
  }
  const duplicate = pref();
  duplicate.watchlist.push({ ...stock, symbol: "BSE_ALIAS" });
  assert.throws(() => validatePreferences(duplicate), /Duplicate/);
  const names = pref();
  names.presets.push({ ...names.presets[0], name: "leaders" });
  assert.throws(() => validatePreferences(names), /Duplicate/);
  const invalid = pref();
  invalid.watchlist[0].security_id = "../../x";
  assert.throws(() => validatePreferences(invalid), /identifier/);
});
test("reject unsafe filter values and preserve valid empty/negative relative-strength thresholds", () => {
  for (const change of [
    { minVolume: "-1" },
    { minAdx: "101" },
    { minRs: "NaN" },
    { minRs: "Infinity" },
    { direction: "evil" },
    { sort: "__proto__" },
    { columns: ["rs", "rs"] },
    { phase: "Buy now" },
    { exchange: "X" },
  ])
    assert.throws(() => validateFilters({ ...defaultFilters(), ...change }));
  assert.equal(
    validateFilters({ ...defaultFilters(), minRs: "-3" }).minRs,
    "-3",
  );
});
test("caps imports, presets and watched stocks without mutating current preferences", () => {
  assert.throws(
    () => importBackup(" ".repeat(1_000_001), "sample", pref()),
    /1 MB/,
  );
  assert.throws(
    () =>
      validatePreferences({
        watchlist: [],
        presets: Array(21).fill(pref().presets[0]),
      }),
    /Limit/,
  );
  assert.throws(
    () =>
      validatePreferences({ watchlist: Array(501).fill(stock), presets: [] }),
    /Limit/,
  );
  for (const value of ["null", "{}", "[1]", "{bad json"])
    assert.throws(() => parseLibrary(value));
});
