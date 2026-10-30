export function formatCnpj(value: string) {
  const text = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 14);
  // The final two positions are always numeric check digits.
  const base = text.slice(0, 12) + text.slice(12).replace(/\D/g, "");
  return base
    .replace(/^(.{2})(.)/, "$1.$2")
    .replace(/^(.{6})(.)/, "$1.$2")
    .replace(/^(.{10})(.)/, "$1/$2")
    .replace(/^(.{15})(.)/, "$1-$2");
}

export function formatCep(value: string) {
  return value
    .replace(/\D/g, "")
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
}
