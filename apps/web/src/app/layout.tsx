import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Comandei · Sua operação em boa companhia",
  description:
    "Acesse sua conta Comandei e cuide da operação do seu restaurante.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
