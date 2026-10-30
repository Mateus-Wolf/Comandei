export type ProductUnit = "unit" | "kg" | "g" | "l" | "ml";
export type StockCategory = {
  id: string;
  name: string;
  active: boolean;
  position: number;
  version: number;
};
export type StockProduct = {
  id: string;
  name: string;
  sku: string | null;
  category_id: string;
  category_name: string;
  unit: ProductUnit;
  price_cents: number;
  available: boolean;
  active: boolean;
  version: number;
};
export type StockOverview = {
  items: StockProduct[];
  next_cursor: string | null;
  categories: StockCategory[];
  summary: {
    total: number;
    available: number;
    unavailable: number;
    inactive: number;
  };
};
export const unitLabels: Record<ProductUnit, string> = {
  unit: "Unidade",
  kg: "Quilograma (kg)",
  g: "Grama (g)",
  l: "Litro (l)",
  ml: "Mililitro (ml)",
};
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export function priceInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}
export function parsePrice(value: string) {
  if (!/^\d{1,12}(?:[,.]\d{1,2})?$/.test(value.trim()))
    throw new Error("Informe um preço válido, como 12,50.");
  const [whole, decimals = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("O preço informado é muito alto.");
  return cents;
}
