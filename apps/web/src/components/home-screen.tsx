"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/browser";
import { Brand } from "./brand";
type Tenant = { id: string; name: string; role: string; status: string };
const roles: Record<string, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  cashier: "Caixa",
  waiter: "Garçom",
};
export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string }>();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    const client = supabase();
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/entrar");
    });
    async function load() {
      try {
        const { data, error: authError } = await client.auth.getUser();
        if (!active) return;
        if (authError || !data.user) {
          router.replace("/entrar");
          return;
        }
        setUser({
          name:
            typeof data.user.user_metadata.display_name === "string"
              ? data.user.user_metadata.display_name
              : "Boas-vindas",
          email: data.user.email ?? "",
        });
        const { data: session } = await client.auth.getSession();
        if (!session.session) {
          router.replace("/entrar");
          return;
        }
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/v1/me/tenants`,
          {
            headers: {
              Authorization: `Bearer ${session.session.access_token}`,
            },
            signal: abort.signal,
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error("api");
        const result = await response.json();
        if (active) setTenants(result.items);
      } catch {
        if (active)
          setError(
            "Não foi possível consultar seus restaurantes. Confira se a API está disponível e tente recarregar a página.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      abort.abort();
      listener.subscription.unsubscribe();
    };
  }, [router]);
  async function logout() {
    setSigningOut(true);
    const { error } = await supabase().auth.signOut({ scope: "local" });
    if (error) {
      setError("Não foi possível sair. Tente novamente.");
      setSigningOut(false);
    } else router.replace("/entrar");
  }
  return (
    <div className="home-shell">
      <a href="#home-main" className="skip-link">
        Pular para o conteúdo
      </a>
      <aside className="home-sidebar" aria-label="Menu lateral">
        <div className="sidebar-heading">
          <Brand href="/home" />
          <button
            className="menu-toggle secondary-button"
            aria-expanded={menuOpen}
            aria-controls="sidebar-content"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? "Fechar" : "Menu"}
          </button>
        </div>
        <div
          id="sidebar-content"
          className={`sidebar-content ${menuOpen ? "is-open" : ""}`}
        >
          <div className="sidebar-navigation">
            <span className="eyebrow">SEU ESPAÇO</span>
            <nav aria-label="Menu principal">
              <Link
                href="/home"
                aria-current="page"
                onClick={() => setMenuOpen(false)}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
                </svg>
                Início
                <span className="nav-indicator" />
              </Link>
            </nav>
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="note-dot" />
              Uma operação mais leve começa com uma boa organização.
            </div>
            <div className="sidebar-user">
              <span className="user-avatar" aria-hidden="true">
                {user?.name.trim().charAt(0).toUpperCase() || "C"}
              </span>
              <div>
                <strong>{user?.name ?? "Sua conta"}</strong>
                <span>{user?.email ?? "Comandei"}</span>
              </div>
            </div>
            <button
              className="logout-button"
              onClick={logout}
              disabled={signingOut}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M9 4H4v16h5m6-12 4 4-4 4m-9-4h13" />
              </svg>
              {signingOut ? "Saindo…" : "Sair da conta"}
            </button>
          </div>
        </div>
      </aside>
      <main className="home-main" id="home-main" tabIndex={-1}>
        <header className="home-topbar">
          <span>
            Visão geral <span aria-hidden="true">/</span>{" "}
            <strong>Início</strong>
          </span>
          <span className="home-product">COMANDEI</span>
        </header>
        <div className="home-content">
          <section className="home-welcome">
            <span className="eyebrow">BEM-VINDO AO SEU ESPAÇO</span>
            <h1>{user ? `Olá, ${user.name}.` : "Boas-vindas ao Comandei."}</h1>
            <p>Um lugar para cuidar de cada detalhe do seu restaurante.</p>
            <span className="welcome-decoration" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </section>
          <section
            className="home-restaurants"
            aria-labelledby="restaurants-title"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">SUA OPERAÇÃO</span>
                <h2 id="restaurants-title">Seus restaurantes</h2>
              </div>
              <span className="section-description">Tudo começa por aqui.</span>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {loading ? (
              <p role="status">Buscando seus acessos…</p>
            ) : (
              !error &&
              (tenants.length ? (
                <>
                  <div className="tenant-list">
                    {tenants.map((tenant) => (
                      <article key={tenant.id}>
                        <span className="tenant-icon" aria-hidden="true">
                          C
                        </span>
                        <div>
                          <h3>{tenant.name}</h3>
                          <p>{roles[tenant.role] ?? tenant.role}</p>
                        </div>
                        <span className="badge">
                          {tenant.status === "active"
                            ? "Ativo"
                            : tenant.status === "suspended"
                              ? "Suspenso"
                              : tenant.status === "blocked"
                                ? "Bloqueado"
                                : "Indisponível"}
                        </span>
                      </article>
                    ))}
                  </div>
                  <p className="helper">
                    Estes são os restaurantes vinculados à sua conta.
                  </p>
                </>
              ) : (
                <div className="empty-state">
                  <span className="step-icon" aria-hidden="true">
                    ✓
                  </span>
                  <h2>Seu perfil está pronto</h2>
                  <p>
                    Você ainda não está vinculado a um restaurante. Peça um
                    convite ao responsável pela sua equipe para começar.
                  </p>
                </div>
              ))
            )}
          </section>
          <footer>Comandei · Gestão de restaurantes</footer>
        </div>
      </main>
    </div>
  );
}
