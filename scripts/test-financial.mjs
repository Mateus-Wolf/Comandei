import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(
    new URL("../apps/web/src/lib/financial.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { financialDate, validateFinancialPeriod } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

test("financial periods validate real dates, inclusive 31-day limit and date ordering", () => {
  assert.equal(validateFinancialPeriod("2026-10-01", "2026-10-31"), "");
  assert.equal(validateFinancialPeriod("2026-10-27", "2026-10-27"), "");
  for (const [start, end] of [
    ["2026-10-01", "2026-11-01"],
    ["2026-10-28", "2026-10-27"],
    ["2026-02-30", "2026-03-01"],
    ["", "2026-10-27"],
  ])
    assert.notEqual(validateFinancialPeriod(start, end), "");
  assert.equal(financialDate("2026-10-27"), "27/10/2026");
  assert.equal(financialDate("2026-10-27", true), "27/10");
});

test("financial PostgreSQL query isolates tenants and aggregates sales, split payments, refunds and cash without multiplying totals", async () => {
  // Extract the actual Python SQL constant without importing configuration or
  // connecting to any remote service. All fixtures below live only in memory.
  const python =
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python";
  const extracted = spawnSync(
    python,
    [
      "-c",
      [
        "import ast, pathlib",
        "tree = ast.parse(pathlib.Path('apps/api/comandei/modules/reports.py').read_text(encoding='utf-8'))",
        "fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'financial')",
        "sql = next(n.args[0].value for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'query')",
        "print(sql)",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  const db = new PGlite();
  const tenant = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000002";
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`create schema app;
      create table app.cash_sessions(id uuid,tenant_id uuid,business_date date,status text,difference_cents bigint);
      create table app.payment_entries(tenant_id uuid,cash_session_id uuid,method text,type text,amount_cents bigint);
      create table app.cash_movements(tenant_id uuid,session_id uuid,type text,amount_cents bigint);
      create table app.tabs(id uuid,tenant_id uuid,business_date date,status text);
      create table app.tab_settlements(tenant_id uuid,tab_id uuid,status text,subtotal_cents bigint,discount_cents bigint,service_cents bigint,total_cents bigint);
      insert into app.cash_sessions values
        ('${id(10)}','${tenant}','2026-10-27','closed',-100),
        ('${id(11)}','${tenant}','2026-10-28','open',null),
        ('${id(12)}','${other}','2026-10-27','closed',99999),
        ('${id(13)}','${tenant}','2026-10-25','closed',88888);
      insert into app.tabs values
        ('${id(20)}','${tenant}','2026-10-27','closed'),
        ('${id(21)}','${tenant}','2026-10-26','closed'),
        ('${id(22)}','${tenant}','2026-10-27','closing'),
        ('${id(23)}','${other}','2026-10-27','closed');
      insert into app.tab_settlements values
        ('${tenant}','${id(20)}','settled',2600,300,200,2500),
        ('${tenant}','${id(20)}','superseded',99999,0,0,99999),
        ('${tenant}','${id(21)}','settled',1200,0,0,1200),
        ('${tenant}','${id(22)}','active',99999,0,0,99999),
        ('${other}','${id(23)}','settled',99999,0,0,99999);
      insert into app.payment_entries values
        ('${tenant}','${id(10)}','cash','receipt',1500),
        ('${tenant}','${id(10)}','pix','receipt',1000),
        ('${tenant}','${id(10)}','pix','refund',500),
        ('${tenant}','${id(11)}','cash','refund',300),
        ('${other}','${id(12)}','cash','receipt',99999),
        ('${tenant}','${id(13)}','cash','receipt',88888);
      insert into app.cash_movements values
        ('${tenant}','${id(10)}','supply',2000),
        ('${tenant}','${id(10)}','withdrawal',1000),
        ('${other}','${id(12)}','supply',99999);`);
    const indexes = { tenant: 1, start: 2, end: 3, days: 4 };
    const sql = extracted.stdout
      .trim()
      .replace(
        /(?<!:):(tenant|start|end|days)\b/g,
        (_, name) => `$${indexes[name]}`,
      );
    const {
      rows: [result],
    } = await db.query(sql, [tenant, "2026-10-26", "2026-10-28", 2]);
    assert.equal(result.days.length, 3);
    assert.deepEqual(
      result.days.map((day) => day.sales_cents),
      [1200, 2500, 0],
    );
    assert.deepEqual(
      result.days.map((day) => day.closed_tabs),
      [1, 1, 0],
    );
    assert.deepEqual(
      result.days.map((day) => day.net_received_cents),
      [0, 2000, -300],
    );
    assert.equal(result.days[1].discount_cents, 300);
    assert.equal(result.days[1].service_cents, 200);
    assert.deepEqual(result.cash, {
      supply_cents: 2000,
      withdrawal_cents: 1000,
      difference_cents: -100,
      closed_sessions: 1,
      open_sessions: 1,
    });
    assert.deepEqual(result.payments_by_method, [
      { method: "cash", receipts_cents: 1500, refunds_cents: 300 },
      { method: "pix", receipts_cents: 1000, refunds_cents: 500 },
    ]);
    const empty = (
      await db.query(sql, [tenant, "2020-01-01", "2020-01-31", 30])
    ).rows[0];
    assert.equal(empty.days.length, 31);
    assert.ok(
      empty.days.every(
        (day) => day.sales_cents === 0 && day.net_received_cents === 0,
      ),
    );
    assert.deepEqual(empty.payments_by_method, []);
    assert.equal(empty.cash.supply_cents, 0);
  } finally {
    await db.close();
  }
});
