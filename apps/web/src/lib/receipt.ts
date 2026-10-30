import { cashDate, methodLabels, money } from "./cash";
export type Receipt = {
  number: number;
  opened_at: string;
  closed_at: string | null;
  restaurant: {
    name: string;
    cnpj: string | null;
    address: string | null;
    timezone: string;
  };
  table: { code: string; name: string } | null;
  guests: {
    label: string;
    quantity: number;
    name_snapshot: string;
    unit_price_cents: number;
    complimentary: boolean;
  }[];
  orders: {
    items: {
      name_snapshot: string;
      quantity: string;
      unit_price_cents: number;
      line_total_cents: number;
      status: string;
      modifiers: {
        name_snapshot: string;
        quantity: number;
        unit_price_cents: number;
      }[];
    }[];
  }[];
  payments: {
    type: string;
    method: string;
    amount_cents: number;
    tendered_cents?: number | null;
    created_at: string;
  }[];
  adjustments: {
    type: string;
    amount_cents: number;
    reason: string;
    voided_at: string | null;
  }[];
  amounts: {
    subtotal_cents: number;
    discount_cents: number;
    service_cents: number;
    total_cents: number;
    received_cents: number;
  };
};
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function receiptHtml(receipt: Receipt) {
  const date = (value: string) =>
    escape(cashDate(value, receipt.restaurant.timezone || "America/Sao_Paulo"));
  const row = (label: string, value: string) =>
    `<tr><td>${escape(label)}</td><td>${escape(value)}</td></tr>`;
  const guests = receipt.guests
    .map((g) =>
      row(
        `${g.quantity} × ${g.name_snapshot || g.label} · ${g.label}`,
        g.complimentary ? "Cortesia" : money(g.quantity * g.unit_price_cents),
      ),
    )
    .join("");
  const items = receipt.orders
    .flatMap((o) => o.items)
    .filter((i) => i.status !== "cancelled")
    .map((i) => {
      const quantity = Number(i.quantity);
      return (
        row(
          `${quantity.toLocaleString("pt-BR")} × ${i.name_snapshot}`,
          money(i.line_total_cents),
        ) +
        i.modifiers
          .map((m) =>
            row(
              `  + ${m.quantity} × ${m.name_snapshot}`,
              `${money(m.unit_price_cents)} / un.`,
            ),
          )
          .join("")
      );
    })
    .join("");
  const payments = receipt.payments
    .map(
      (p) =>
        row(
          `${p.type === "refund" ? "Estorno" : "Recebimento"} · ${methodLabels[p.method] ?? p.method}`,
          money(p.amount_cents),
        ) +
        `<tr><td colspan="2">${date(p.created_at)}</td></tr>` +
        (p.type === "receipt" && p.tendered_cents != null
          ? row("Dinheiro entregue", money(p.tendered_cents)) +
            row("Troco", money(p.tendered_cents - p.amount_cents))
          : ""),
    )
    .join("");
  const discounts = receipt.adjustments
    .filter((a) => a.type === "discount" && !a.voided_at)
    .map((a) => row(a.reason, money(a.amount_cents)))
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comanda ${escape(receipt.number)}</title><style>
  @page { margin: 8mm; } body { font: 12px Arial,sans-serif; color: #000; max-width: 76mm; margin: 0 auto; } h1 { font-size: 18px; } h1,h2,header { text-align:center; } h2 { font-size: 13px; border-top: 1px dashed #777; padding-top:10px; } table { width:100%; border-collapse:collapse; } td { vertical-align:top; padding:4px 0; overflow-wrap:anywhere; } td:last-child { text-align:right; } p { overflow-wrap:anywhere; } tr { break-inside:avoid; } .total { font-size:16px; font-weight:bold; } </style></head><body>
  <header><h1>${escape(receipt.restaurant.name)}</h1>${receipt.restaurant.cnpj ? `<p>CNPJ ${escape(receipt.restaurant.cnpj)}</p>` : ""}<p>${escape(receipt.restaurant.address)}</p><strong>RECIBO NÃO FISCAL</strong><p>Comanda ${escape(receipt.number)} · ${receipt.table ? `Mesa ${escape(receipt.table.code)}` : "Balcão"}</p></header>
  <p>Abertura: ${date(receipt.opened_at)}<br>Fechamento: ${receipt.closed_at ? date(receipt.closed_at) : "—"}</p>
  <h2>Pessoas na mesa: ${receipt.guests.reduce((sum, g) => sum + g.quantity, 0)}</h2>${receipt.guests.length ? `<table>${guests}</table>` : "<p>Quantidade de pessoas não informada.</p>"}
  <h2>Consumo</h2><table>${items}</table>
  <h2>Valores</h2><table>${row("Consumo (inclui rodízios)", money(receipt.amounts.subtotal_cents))}${row("Descontos", money(receipt.amounts.discount_cents))}${row("Serviço", money(receipt.amounts.service_cents))}</table>
  ${discounts ? `<h2>Descontos aplicados</h2><table>${discounts}</table>` : ""}
  <p class="total">Total: ${escape(money(receipt.amounts.total_cents))}</p><h2>Pagamentos</h2><table>${payments}</table><p>Recebido líquido: ${escape(money(receipt.amounts.received_cents))}</p><p>Documento de conferência do consumo e recebimento.</p></body></html>`;
}
export function printReceipt(receipt: Receipt) {
  document.getElementById("comandei-receipt-print")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "comandei-receipt-print";
  frame.title = "Impressão do recibo";
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;";
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  };
  frame.srcdoc = receiptHtml(receipt);
  document.body.appendChild(frame);
}
