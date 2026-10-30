import type { DiningTable } from "./api";

export const tableStatusLabels = {
  available: "Disponível",
  open: "Em atendimento",
  closing: "Aguardando caixa",
  inactive: "Inativa",
};
export type TableStatus = keyof typeof tableStatusLabels;
export function tableStatus(table: DiningTable): TableStatus {
  if (!table.active) return "inactive";
  if (!table.active_tab) return "available";
  return table.active_tab.status === "closing" ? "closing" : "open";
}
export function filterTables(
  tables: DiningTable[],
  search: string,
  status: string,
) {
  const query = search.trim().toLocaleLowerCase("pt-BR");
  return tables
    .filter(
      (table) =>
        (!status || tableStatus(table) === status) &&
        (!query ||
          `${table.code} ${table.name} ${table.active_tab?.number ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(query)),
    )
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
}
