import { parsePrice } from "./stock";
export { money, priceInput as amountInput } from "./stock";
export type CashRegister = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  occupied: boolean;
};
export type CashSession = {
  id: string;
  register_id: string;
  register_name: string;
  register_code: string;
  status: "open" | "closing" | "closed";
  version: number;
  business_date: string;
  opened_at: string;
  closed_at: string | null;
  initial_balance_cents: number;
  declared_cents: number | null;
  expected_cents: number | null;
  difference_cents: number | null;
  closing_reason: string | null;
};
export type CashTab = {
  id: string;
  number: number;
  status: "open" | "closing";
  version: number;
  table_code: string | null;
};
export type CashActivity = {
  id: string;
  kind: "receipt" | "refund" | "supply" | "withdrawal";
  method: string | null;
  amount_cents: number;
  reason: string | null;
  occurred_at: string;
  tab_number: number | null;
};
export type CashOverview = {
  registers: CashRegister[];
  sessions: CashSession[];
  session: CashSession | null;
  tabs: CashTab[];
  totals: {
    receipts_cents: number;
    cash_cents: number;
    supply_cents: number;
    withdrawal_cents: number;
    expected_cash_cents: number;
  };
  activity: CashActivity[];
  timezone: string;
  difference_tolerance_cents: number;
};
export const methodLabels: Record<string, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  credit_card: "Crédito",
  debit_card: "Débito",
  other: "Outros",
};
export const activityLabels = {
  receipt: "Recebimento",
  refund: "Estorno",
  supply: "Suprimento",
  withdrawal: "Sangria",
};
export function parseAmount(value: string) {
  try {
    return parsePrice(value);
  } catch {
    throw new Error("Informe um valor válido, como 12,50.");
  }
}
export function cashDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
