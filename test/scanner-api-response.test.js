import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/scanner/api-response.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { readResearchResponse } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
test("scanner keeps valid JSON and structured validation errors", async () => {
  assert.deepEqual(
    await readResearchResponse(new Response('[{"id":"fixture"}]')),
    [{ id: "fixture" }],
  );
  await assert.rejects(
    readResearchResponse(
      new Response(
        JSON.stringify({
          detail: [{ loc: ["body", "as_of"], msg: "Invalid date" }],
        }),
        { status: 422 },
      ),
    ),
    /body.as_of: Invalid date/,
  );
  await assert.rejects(
    readResearchResponse(
      new Response(JSON.stringify({ error: "Private backend unavailable" }), {
        status: 502,
      }),
    ),
    /Private backend unavailable/,
  );
});
test("scanner handles plain-text platform 404 and HTML without exposing their bodies", async () => {
  await assert.rejects(
    readResearchResponse(
      new Response("The page could not be found\nNOT_FOUND", { status: 404 }),
    ),
    /non-JSON response \(HTTP 404\).*route was not found/,
  );
  await assert.rejects(
    readResearchResponse(
      new Response("<html>private platform body</html>", { status: 502 }),
    ),
    (error) =>
      error.message.includes("HTTP 502") &&
      !error.message.includes("private platform body"),
  );
  await assert.rejects(
    readResearchResponse(new Response("null")),
    /unexpected response format/,
  );
});
