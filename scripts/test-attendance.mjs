import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";

test("batched attendance SQL preserves modifier sums and excludes other tabs and tenants", async () => {
  const extracted = spawnSync(
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
    [
      "-c",
      [
        "import ast, json, pathlib",
        "tree = ast.parse(pathlib.Path('apps/api/comandei/modules/attendance.py').read_text(encoding='utf-8'))",
        "queries = [n.args[0].value for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'query' and isinstance(n.args[0], ast.Constant)]",
        "print(json.dumps([q for q in queries if q.startswith(('select i.quantity', 'select i.*', 'select m.*'))]))",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  const queries = JSON.parse(extracted.stdout);
  assert.equal(queries.length, 3);
  const db = new PGlite();
  try {
    await db.exec(`
      create schema app;
      create table app.orders(id int, tenant_id int, tab_id int);
      create table app.order_items(id int, tenant_id int, order_id int,
        quantity numeric, unit_price_cents bigint, status text, created_at int);
      create table app.order_item_modifiers(id int, tenant_id int, item_id int,
        unit_price_cents bigint, quantity numeric);
      insert into app.orders values (10,1,100),(11,1,100),(12,1,101),(10,2,100);
      insert into app.order_items values
        (20,1,10,0.125,3,'submitted',1),
        (21,1,10,2,100,'delivered',2),
        (22,1,11,1,500,'cancelled',3),
        (23,1,12,1,99999,'submitted',4),
        (20,2,10,1,99999,'submitted',5);
      insert into app.order_item_modifiers values
        (30,1,20,1,1),(31,1,21,50,2),(32,1,21,25,0.5),
        (33,1,22,99999,1),(34,1,23,99999,1),(35,2,20,99999,1);
    `);
    for (const query of queries) {
      const sql = query
        .replace(/(?<!:):tenant\b/g, "$1")
        .replace(/(?<!:):tab\b/g, "$2");
      const { rows } = await db.query(sql, [1, 100]);
      if (query.startsWith("select i.quantity")) {
        assert.deepEqual(
          rows.map((row) => Number(row.modifiers_cents)),
          [1, 112.5],
        );
        assert.deepEqual(
          rows.map((row) => Number(row.quantity)),
          [0.125, 2],
        );
      } else if (query.startsWith("select i.*")) {
        // Cancelled lines remain visible in detail, but cannot enter the total.
        assert.deepEqual(
          rows.map((row) => row.id),
          [20, 21, 22],
        );
      } else {
        assert.deepEqual(
          rows.map((row) => row.id),
          [30, 31, 32, 33],
        );
      }
      assert.deepEqual((await db.query(sql, [1, 999])).rows, []);
    }
    await db.exec(
      "delete from app.order_item_modifiers where tenant_id=1 and item_id=20",
    );
    const sql = queries
      .find((q) => q.startsWith("select i.quantity"))
      .replace(/(?<!:):tenant\b/g, "$1")
      .replace(/(?<!:):tab\b/g, "$2");
    assert.equal(
      Number((await db.query(sql, [1, 100])).rows[0].modifiers_cents),
      0,
    );
  } finally {
    await db.close();
  }
});
