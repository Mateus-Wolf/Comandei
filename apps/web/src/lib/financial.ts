import type { components } from "../../../../packages/api-client/schema";

export type FinancialOverview = components["schemas"]["FinancialOverview"];
export type FinancialDay = FinancialOverview["days"][number];
export type FinancialPeriod = "today" | "week" | "month" | "custom";
export function financialDate(value: string, short = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    ...(short ? {} : { year: "numeric" }),
  }).format(new Date(`${value}T12:00:00Z`));
}
export function validateFinancialPeriod(start: string, end: string) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
      ? timestamp
      : NaN;
  };
  const first = parse(start);
  const last = parse(end);
  if (!Number.isFinite(first) || !Number.isFinite(last))
    return "Informe as duas datas do período.";
  if (last < first)
    return "A data final deve ser igual ou posterior à inicial.";
  if ((last - first) / 86400000 > 30)
    return "Selecione um período de até 31 dias.";
  return "";
}
