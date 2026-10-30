import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  readFileSync(
    new URL("../apps/web/src/lib/tables.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { tableStatus, filterTables } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const tables = [
  { id: "a", code: "10", name: "Varanda", active: true, active_tab: null },
  {
    id: "b",
    code: "2",
    name: "Salão",
    active: true,
    active_tab: { number: 305, status: "open" },
  },
  {
    id: "c",
    code: "3",
    name: "Janela",
    active: true,
    active_tab: { number: 306, status: "closing" },
  },
  { id: "d", code: "4", name: "Reserva", active: false, active_tab: null },
];
test("a table waiting for checkout remains occupied; inactive tables are separate", () => {
  assert.deepEqual(tables.map(tableStatus), [
    "available",
    "open",
    "closing",
    "inactive",
  ]);
  assert.deepEqual(
    filterTables(tables, "", "available").map((t) => t.id),
    ["a"],
  );
  assert.deepEqual(
    filterTables(tables, "", "closing").map((t) => t.id),
    ["c"],
  );
});
test("monitor combines status and search by name, table or tab, sorting naturally without mutating the source", () => {
  assert.deepEqual(
    filterTables(tables, "  SALÃO ", "open").map((t) => t.id),
    ["b"],
  );
  assert.deepEqual(
    filterTables(tables, "306", "closing").map((t) => t.id),
    ["c"],
  );
  assert.deepEqual(filterTables(tables, "306", "available"), []);
  assert.deepEqual(
    filterTables(tables, "10", "").map((t) => t.id),
    ["a"],
  );
  assert.deepEqual(
    filterTables(tables, "", "").map((t) => t.code),
    ["2", "3", "4", "10"],
  );
  assert.equal(tables[0].code, "10");
});
