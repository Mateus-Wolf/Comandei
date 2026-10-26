"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/browser";
import { Brand } from "../../components/brand";
type Tenant = { id: string; name: string; role: string; status: string };
const roles: Record<string, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  cashier: "Caixa",
  waiter: "Garçom",
};
export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string }>();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
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
    <main className="account-shell">
      <header>
        <Brand />
        <button
          className="secondary-button"
          onClick={logout}
          disabled={signingOut}
        >
          {signingOut ? "Saindo…" : "Sair da conta"}
        </button>
      </header>
      <section className="account-card">
        <span className="eyebrow">SUA CONTA COMANDEI</span>
        <h1>{user ? `Olá, ${user.name}.` : "Carregando sua conta…"}</h1>
        {user && <p className="intro">{user.email}</p>}
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
              <h2>Seus restaurantes</h2>
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
                Seus vínculos estão prontos. As telas de operação serão
                disponibilizadas na próxima etapa.
              </p>
            </>
          ) : (
            <div className="empty-state">
              <span className="step-icon" aria-hidden="true">
                ✓
              </span>
              <h2>Seu perfil está pronto</h2>
              <p>
                Você ainda não está vinculado a um restaurante. Peça um convite
                ao responsável pela sua equipe para começar.
              </p>
            </div>
          ))
        )}
      </section>
      <footer>Comandei · Gestão de restaurantes</footer>
    </main>
  );
}
