import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const { outputText } = ts.transpileModule(
  readFileSync(
    new URL("../apps/web/src/lib/stock.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
);
const { parsePrice, priceInput } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
test("prices preserve cents without floating point rounding", () => {
  assert.equal(parsePrice("12,50"), 1250);
  assert.equal(parsePrice("0,29"), 29);
  assert.equal(parsePrice("12.5"), 1250);
  assert.equal(parsePrice("0"), 0);
  assert.equal(parsePrice(" 10,99 "), 1099);
  assert.equal(priceInput(1099), "10,99");
});
test("invalid prices cannot be submitted", () => {
  for (const value of [
    "",
    "-1",
    "1,999",
    "1e4",
    "NaN",
    "1.234,56",
    "99999999999999999",
  ])
    assert.throws(() => parsePrice(value));
});
