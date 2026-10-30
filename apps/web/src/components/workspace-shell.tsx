"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/browser";
import {
  api,
  clearApiCache,
  message,
  RequestError,
  type Restaurant,
} from "../lib/api";
import { Brand } from "./brand";
import { Icon } from "./icons";
type Workspace = {
  user: { name: string; email: string } | undefined;
  restaurants: Restaurant[];
  canCreate: boolean;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};
const Context = createContext<Workspace | null>(null);
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("Workspace ausente.");
  return context;
}
const navigation = [
  { href: "/home", label: "Início", icon: "home" },
  { href: "/mesas", label: "Dashboard de mesas", icon: "table" },
  { href: "/restaurantes", label: "Restaurantes", icon: "restaurants" },
  { href: "/funcionarios", label: "Funcionários", icon: "employees" },
  { href: "/estoque", label: "Estoque", icon: "stock" },
  { href: "/caixa", label: "Caixa", icon: "cash" },
  { href: "/financeiro", label: "Dashboard financeiro", icon: "chart" },
  { href: "/aprovacoes", label: "Aprovações", icon: "employees" },
  { href: "/configuracoes", label: "Configurações", icon: "restaurants" },
] as const;
export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<Workspace["user"]>();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const reloadSequence = useRef(0);
  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    try {
      const result = await api<{ items: Restaurant[]; can_create: boolean }>(
        "/restaurants",
      );
      if (sequence !== reloadSequence.current) return;
      setRestaurants(result.items);
      setCanCreate(result.can_create);
      setError("");
    } catch (error) {
      if (sequence !== reloadSequence.current) return;
      setError(message(error));
      if (error instanceof RequestError && error.status === 401)
        router.replace("/entrar");
    }
  }, [router]);
  useEffect(() => {
    let active = true;
    const client = supabase();
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearApiCache();
        router.replace("/entrar");
      }
    });
    async function load() {
      try {
        // Local session draws the shell immediately; every API request still verifies the JWT.
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error || !data.session) {
          router.replace("/entrar");
          return;
        }
        setUser({
          name:
            typeof data.session.user.user_metadata.display_name === "string"
              ? data.session.user.user_metadata.display_name
              : "Boas-vindas",
          email: data.session.user.email ?? "",
        });
        await reload();
      } catch (error) {
        if (active) setError(message(error));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router, reload]);
  async function logout() {
    setSigningOut(true);
    try {
      const { error } = await supabase().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.replace("/entrar");
    } catch (error) {
      setError(message(error));
      setSigningOut(false);
    }
  }
  const management =
    canCreate ||
    restaurants.some(
      (item) => item.role === "owner" || item.role === "manager",
    );
  const canCash =
    management || restaurants.some((item) => item.role === "cashier");
  const visibleNavigation = navigation.filter(
    (item) =>
      (item.href !== "/configuracoes" ||
        restaurants.some((r) => r.role === "owner")) &&
      (management ||
        item.href === "/mesas" ||
        item.href === "/restaurantes" ||
        (canCash && item.href === "/caixa")),
  );
  const allowedPath =
    management ||
    (!restaurants.length && pathname === "/home") ||
    visibleNavigation.some(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
    );
  useEffect(() => {
    if (!loading && !error && restaurants.length && !allowedPath) {
      router.replace("/mesas");
    }
  }, [loading, error, restaurants, allowedPath, router]);
  const current = navigation.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );
  return (
    <Context.Provider
      value={{ user, restaurants, canCreate, loading, error, reload }}
    >
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
                {visibleNavigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={
                      current?.href === item.href ? "page" : undefined
                    }
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {current?.href === item.href && (
                      <span className="nav-indicator" />
                    )}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="sidebar-bottom">
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
                <Icon name="logout" />
                {signingOut ? "Saindo…" : "Sair da conta"}
              </button>
            </div>
          </div>
        </aside>
        <main className="home-main" id="home-main" tabIndex={-1}>
          <header className="home-topbar">
            <span>
              Visão geral <span aria-hidden="true">/</span>{" "}
              <strong>{current?.label ?? "Início"}</strong>
            </span>
            <span className="home-product">COMANDEI</span>
          </header>
          <div className="home-content">
            {error && (
              <div className="error" role="alert">
                {error}
                <button className="text-button" onClick={() => void reload()}>
                  Tentar novamente
                </button>
              </div>
            )}
            {user ? children : <p role="status">Preparando seu espaço…</p>}
            <footer>Comandei · Gestão de restaurantes</footer>
          </div>
        </main>
      </div>
    </Context.Provider>
  );
}
