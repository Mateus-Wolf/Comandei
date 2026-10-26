"use client";
import Link from "next/link";
import { useWorkspace } from "./workspace-shell";
export default function HomeScreen() {
  const { user, restaurants, loading } = useWorkspace();
  return (
    <>
      <section className="home-welcome">
        <span className="eyebrow">BEM-VINDO AO SEU ESPAÇO</span>
        <h1>Olá, {user?.name}.</h1>
        <p>Um lugar para cuidar de cada detalhe do seu restaurante.</p>
        <span className="welcome-decoration" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </section>
      <section className="home-restaurants">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SUA OPERAÇÃO</span>
            <h2>Seus restaurantes</h2>
          </div>
          <Link href="/restaurantes" className="text-button">
            Ver restaurantes →
          </Link>
        </div>
        {loading ? (
          <p role="status">Buscando seus acessos…</p>
        ) : (
          <div className="empty-state">
            <span className="step-icon" aria-hidden="true">
              {restaurants.length || "✓"}
            </span>
            <h2>
              {restaurants.length
                ? "Sua operação em um só lugar"
                : "Seu perfil está pronto"}
            </h2>
            <p>
              {restaurants.length
                ? `Você tem acesso a ${restaurants.length} restaurante${restaurants.length === 1 ? "" : "s"}. Abra a listagem para consultar suas mesas.`
                : "Abra Restaurantes para cadastrar sua unidade ou consulte o responsável pela sua equipe para receber um convite."}
            </p>
            <Link className="text-button" href="/restaurantes">
              Abrir restaurantes →
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
