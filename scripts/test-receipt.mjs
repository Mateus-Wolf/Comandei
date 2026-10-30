import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
function moduleUrl(name) {
  let code = ts.transpileModule(
    readFileSync(
      new URL(`../apps/web/src/lib/${name}.ts`, import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  code = code.replace(
    /from "\.\/(\w+)"/g,
    (_, dependency) => `from ${JSON.stringify(moduleUrl(dependency))}`,
  );
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const { receiptHtml, printReceipt } = await import(moduleUrl("receipt"));
const receipt = {
  number: 42,
  opened_at: "2026-10-28T15:00:00Z",
  closed_at: "2026-10-28T16:30:00Z",
  restaurant: {
    name: 'Restaurante <script>alert("x")</script>',
    address: "Rua A",
    cnpj: null,
    timezone: "America/Sao_Paulo",
  },
  table: { code: "7", name: "Salão" },
  guests: [
    {
      quantity: 2,
      label: "Aniversariante",
      name_snapshot: "Cortesia",
      unit_price_cents: 0,
      complimentary: true,
    },
  ],
  orders: [
    {
      items: [
        {
          name_snapshot: "Suco & água",
          quantity: "2",
          unit_price_cents: 500,
          line_total_cents: 1200,
          status: "submitted",
          modifiers: [
            { name_snapshot: "Limão", quantity: 1, unit_price_cents: 100 },
          ],
        },
        {
          name_snapshot: "Item cancelado",
          quantity: "1",
          unit_price_cents: 9999,
          line_total_cents: 9999,
          status: "cancelled",
          modifiers: [],
        },
      ],
    },
  ],
  payments: [
    {
      type: "receipt",
      method: "pix",
      amount_cents: 500,
      created_at: "2026-10-28T16:00:00Z",
    },
    {
      type: "receipt",
      method: "cash",
      amount_cents: 600,
      tendered_cents: 1000,
      created_at: "2026-10-28T16:30:00Z",
    },
  ],
  adjustments: [
    {
      type: "discount",
      amount_cents: 100,
      reason: "Cliente frequente",
      voided_at: null,
    },
    {
      type: "discount",
      amount_cents: 500,
      reason: "Anulado",
      voided_at: "2026-10-28",
    },
  ],
  amounts: {
    subtotal_cents: 1200,
    discount_cents: 100,
    service_cents: 0,
    total_cents: 1100,
    received_cents: 1100,
  },
};
test("receipt shows server amounts, people, opening/closing in restaurant timezone, split payments, change and active discounts", () => {
  const html = receiptHtml(receipt);
  for (const text of [
    "RECIBO NÃO FISCAL",
    "Mesa 7",
    "Comanda 42",
    "Pessoas na mesa: 2",
    "Cortesia",
    "12:00",
    "13:30",
    "Suco &amp; água",
    "Limão",
    "Pix",
    "Dinheiro",
    "Troco",
    "Cliente frequente",
    "11,00",
    "12,00",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Item cancelado"));
  assert.ok(!html.includes("Anulado"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("printing replaces the prior frame and prints only when the new receipt has loaded", () => {
  const original = globalThis.document;
  let removed = 0,
    printed = 0,
    appended;
  globalThis.document = {
    getElementById: () => ({
      remove() {
        removed++;
      },
    }),
    createElement: () => ({
      style: {},
      contentWindow: {
        focus() {},
        print() {
          printed++;
        },
      },
    }),
    body: {
      appendChild(frame) {
        appended = frame;
      },
    },
  };
  try {
    printReceipt(receipt);
    assert.equal(removed, 1);
    assert.equal(printed, 0);
    assert.ok(appended.srcdoc.includes("Comanda 42"));
    appended.onload();
    assert.equal(printed, 1);
  } finally {
    globalThis.document = original;
  }
});
