import Link from "next/link";
export function Brand({ href = "/entrar" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="Comandei, início">
      <span className="brand-symbol" aria-hidden="true">
        c<span>•</span>
      </span>
      comandei<span className="brand-dot">.</span>
    </Link>
  );
}
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">MAIS FLUIDEZ, DO PEDIDO AO CAIXA</span>
          <h1>
            O cuidado com
            <br />
            seu restaurante
            <br />
            começa aqui<span>.</span>
          </h1>
          <p>
            Menos tempo organizando a operação.
            <br />
            Mais tempo recebendo bem.
          </p>
          <div className="table-art" aria-hidden="true">
            <span className="plate">
              <span />
            </span>
            <span className="fork">⋮</span>
            <span className="receipt">
              <i />
              <i />
              <i />
              <b>tudo em ordem ✓</b>
            </span>
            <span className="art-label">uma boa experiência, por inteiro.</span>
          </div>
        </div>
        <p className="story-foot">Feito para quem cuida de cada detalhe.</p>
      </section>
      <section className="form-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        {children}
        <footer>Comandei · Gestão de restaurantes</footer>
      </section>
    </main>
  );
}
