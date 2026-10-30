"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FormLoading } from "./form-loading";
import { api, message } from "../lib/api";
import type { StockCategory, StockOverview, StockProduct } from "../lib/stock";
import { useWorkspace } from "./workspace-shell";
import { RestaurantFilter } from "./restaurant-filter";
import { StockProducts } from "./stock-products";
import { Dialog } from "./dialog";
import { Icon } from "./icons";
type Modal =
  | { kind: "categories" }
  | { kind: "category"; category?: StockCategory }
  | { kind: "product"; product?: StockProduct };
const ProductForm = dynamic(
  () => import("./product-form").then((module) => module.ProductForm),
  { loading: FormLoading },
);
const CategoryForm = dynamic(
  () => import("./category-form").then((module) => module.CategoryForm),
  { loading: FormLoading },
);
export default function StockScreen() {
  const {
    restaurants,
    loading: workspaceLoading,
    error: workspaceError,
  } = useWorkspace();
  const manageable = restaurants.filter(
    (item) => item.role === "owner" || item.role === "manager",
  );
  const [selected, setSelected] = useState("");
  const restaurant =
    manageable.find((item) => item.id === selected) ?? manageable[0];
  const tenantId = restaurant?.id;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<{
    key: string;
    tenantId: string;
    result: StockOverview;
  }>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>();
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const key = JSON.stringify([tenantId, debouncedSearch, category, status]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(
    async (signal?: AbortSignal, next?: string) => {
      if (!tenantId) return;
      const request = ++sequence.current;
      const params = new URLSearchParams({
        limit: "30",
        search: debouncedSearch,
        status,
      });
      if (category) params.set("category_id", category);
      if (next) params.set("cursor", next);
      const result = await api<StockOverview>(
        `/tenants/${tenantId}/stock?${params}`,
        { signal },
      );
      if (signal?.aborted || request !== sequence.current) return;
      setData((previous) => ({
        key,
        tenantId,
        result: {
          ...result,
          items:
            next && previous?.key === key
              ? [...previous.result.items, ...result.items]
              : result.items,
        },
      }));
      setError("");
    },
    [tenantId, debouncedSearch, category, status, key],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setLoadingMore(false);
    void load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      sequence.current++;
    };
  }, [load, retry]);
  const current = data?.key === key ? data.result : undefined;
  // Keep category options while changing the product filters, never across units.
  const categoryData =
    data && data.tenantId === tenantId ? data.result.categories : [];
  const canEdit = restaurant?.status === "active";
  const filtered = !!debouncedSearch || !!category || status !== "all";
  async function loadMore() {
    if (!current?.next_cursor || loadingMore || loading) return;
    setLoadingMore(true);
    const pending = load(undefined, current.next_cursor);
    const request = sequence.current;
    try {
      await pending;
    } catch (error) {
      if (request === sequence.current) setError(message(error));
    } finally {
      if (request === sequence.current) setLoadingMore(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRODUTOS DA UNIDADE</span>
          <h1>Estoque</h1>
          <p>
            Organize os produtos, categorias e a disponibilidade do seu
            restaurante.
          </p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!restaurant || !canEdit || workspaceLoading}
            onClick={() => setModal({ kind: "categories" })}
          >
            Categorias
          </button>
          <button
            type="button"
            className="button compact-button"
            disabled={
              !restaurant ||
              !canEdit ||
              workspaceLoading ||
              !current?.categories.some((item) => item.active)
            }
            onClick={() => setModal({ kind: "product" })}
          >
            <Icon name="plus" />
            Cadastrar produto
          </button>
        </div>
      </div>
      {workspaceLoading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : !restaurant ? (
        <section className="empty-state">
          <span className="step-icon">
            <Icon name="stock" />
          </span>
          <h2>
            {restaurants.length
              ? "Gestão de produtos restrita"
              : "Selecione uma unidade para começar"}
          </h2>
          <p>
            {workspaceError
              ? "Não foi possível consultar os restaurantes. Tente novamente pelo aviso acima."
              : restaurants.length
                ? "Apenas administradores e gerentes podem gerenciar os produtos do restaurante."
                : "Cadastre um restaurante para organizar seus produtos."}
          </p>
          <Link className="text-button" href="/restaurantes">
            Ver restaurantes →
          </Link>
        </section>
      ) : (
        <>
          <section className="team-toolbar" aria-label="Filtros do estoque">
            <RestaurantFilter
              restaurants={manageable}
              value={tenantId!}
              onChange={(id) => {
                setSelected(id);
                setSearch("");
                setDebouncedSearch("");
                setCategory("");
                setStatus("all");
                setModal(undefined);
              }}
            />
            <label>
              Buscar produto
              <input
                type="search"
                maxLength={160}
                placeholder="Busque por nome ou código"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </section>
          <div className="stock-filters">
            <label>
              Categoria
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Todas as categorias</option>
                {categoryData.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {!item.active ? " (inativa)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Situação
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">Todos os produtos</option>
                <option value="available">Disponíveis</option>
                <option value="unavailable">Indisponíveis</option>
                <option value="inactive">Inativos</option>
              </select>
            </label>
          </div>
          {!canEdit && (
            <p className="read-only-note">
              Esta unidade está suspensa. Você pode consultar os produtos, mas
              não alterá-los.
            </p>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                type="button"
                className="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {loading || search.trim() !== debouncedSearch ? (
            <p role="status">Carregando produtos…</p>
          ) : (
            current && (
              <StockProducts
                data={current}
                canEdit={canEdit}
                filtered={filtered}
                onEdit={(product) => setModal({ kind: "product", product })}
              />
            )
          )}
          {current?.next_cursor && !loading && (
            <button
              type="button"
              className="secondary-button load-more"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Carregando…" : "Carregar mais produtos"}
            </button>
          )}
          {modal?.kind === "product" && current && (
            <ProductForm
              key={tenantId}
              tenantId={tenantId!}
              categories={current.categories}
              product={modal.product}
              onClose={() => setModal(undefined)}
              onSaved={() => load()}
            />
          )}
          {modal?.kind === "category" && (
            <CategoryForm
              key={tenantId}
              tenantId={tenantId!}
              category={modal.category}
              onClose={() => setModal({ kind: "categories" })}
              onSaved={() => load()}
            />
          )}
          {modal?.kind === "categories" && (
            <Dialog
              title="Categorias de produtos"
              onClose={() => setModal(undefined)}
            >
              <p className="helper">
                Agrupe os produtos para facilitar a organização da unidade.
              </p>
              <ul className="stock-categories">
                {categoryData.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.active ? "Ativa" : "Inativa"}</span>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!canEdit}
                      onClick={() =>
                        setModal({ kind: "category", category: item })
                      }
                      aria-label={`Editar categoria ${item.name}`}
                    >
                      Editar →
                    </button>
                  </li>
                ))}
              </ul>
              {!categoryData.length && (
                <p className="helper">
                  Nenhuma categoria cadastrada neste restaurante.
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setModal(undefined)}
                >
                  Fechar
                </button>
                <button
                  type="button"
                  className="button compact-button"
                  disabled={!canEdit}
                  onClick={() => setModal({ kind: "category" })}
                >
                  <Icon name="plus" />
                  Criar categoria
                </button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
