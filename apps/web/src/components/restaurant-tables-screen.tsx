"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FormLoading } from "./form-loading";
import { api, message, serviceLabels, type DiningTable } from "../lib/api";
import { useWorkspace } from "./workspace-shell";
import { Icon } from "./icons";
const TableForm = dynamic(
  () => import("./table-form").then((module) => module.TableForm),
  { loading: FormLoading },
);
const TabForm = dynamic(
  () => import("./tab-form").then((module) => module.TabForm),
  { loading: FormLoading },
);
const RestaurantForm = dynamic(
  () => import("./restaurant-form").then((module) => module.RestaurantForm),
  { loading: FormLoading },
);
export default function RestaurantTablesScreen({ id }: { id: string }) {
  const { restaurants, loading: workspaceLoading, reload } = useWorkspace();
  const restaurant = restaurants.find((item) => item.id === id);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [attending, setAttending] = useState<DiningTable>();
  const [editing, setEditing] = useState<DiningTable>();
  const [editingRestaurant, setEditingRestaurant] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(
    async (next?: string, fresh = false) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setLoading(true);
      try {
        const result = await api<{
          items: DiningTable[];
          next_cursor: string | null;
        }>(
          `/tenants/${id}/tables?limit=100${next ? "&cursor=" + encodeURIComponent(next) : ""}`,
          { signal: controller.signal, fresh },
        );
        if (controller.signal.aborted) return;
        setTables((previous) =>
          next ? [...previous, ...result.items] : result.items,
        );
        setCursor(result.next_cursor);
        setError("");
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    setTables([]);
    setCursor(null);
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);
  if (workspaceLoading) return <p role="status">Carregando restaurante…</p>;
  if (!restaurant)
    return (
      <div className="empty-state">
        <h1>Restaurante não encontrado</h1>
        <p>Confira se sua conta tem acesso a esta unidade.</p>
        <Link href="/restaurantes">Voltar para restaurantes</Link>
      </div>
    );
  const canEdit = restaurant.role === "owner" && restaurant.status === "active";
  return (
    <>
      <Link className="back-link" href="/restaurantes">
        ← Restaurantes
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MESAS DA UNIDADE</span>
          <h1>{restaurant.name}</h1>
          <p>{restaurant.address ?? "Endereço não informado"}</p>
          <div className="restaurant-details">
            <span className="badge">
              {serviceLabels[restaurant.service_type]}
            </span>
            {restaurant.cnpj && <span>CNPJ {restaurant.cnpj}</span>}
            {restaurant.opens_at && restaurant.closes_at && (
              <span>
                {restaurant.opens_at.slice(0, 5)} às{" "}
                {restaurant.closes_at.slice(0, 5)}
              </span>
            )}
          </div>
        </div>
        <div className="heading-actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void load(undefined, true)}
          >
            {loading ? "Atualizando…" : "Atualizar mesas"}
          </button>
          {canEdit && (
            <>
              <button
                className="secondary-button"
                onClick={() => setEditingRestaurant(true)}
              >
                Editar restaurante
              </button>
              <button
                className="button compact-button"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" />
                Adicionar mesa
              </button>
            </>
          )}
        </div>
      </div>
      {!canEdit && (
        <p className="read-only-note">
          Abra uma comanda para iniciar o atendimento. Apenas o administrador
          pode alterar o cadastro das mesas.
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => void load(undefined, true)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {loading && !tables.length ? (
        <p role="status">Carregando mesas…</p>
      ) : !error && !tables.length ? (
        <div className="empty-state">
          <span className="step-icon">
            <Icon name="table" />
          </span>
          <h2>O salão está pronto para começar</h2>
          <p>
            {canEdit
              ? "Adicione as mesas com seus números e quantidades de assentos."
              : "Ainda não há mesas cadastradas nesta unidade."}
          </p>
        </div>
      ) : (
        <div className="table-grid">
          {[...tables]
            .sort((a, b) =>
              a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
            )
            .map((table) => (
              <article
                className={`table-card ${!table.active ? "inactive-table" : ""}`}
                key={table.id}
              >
                <div className="table-card-top">
                  <span className="table-drawing">
                    <Icon name="table" />
                  </span>
                  <span
                    className={`table-status ${table.active_tab ? "occupied" : ""}`}
                  >
                    {!table.active
                      ? "Inativa"
                      : table.active_tab
                        ? table.active_tab.status === "closing"
                          ? "Aguardando caixa"
                          : "Em atendimento"
                        : "Disponível"}
                  </span>
                </div>
                <h2>Mesa {table.code}</h2>
                <p>
                  {table.capacity
                    ? `${table.capacity} ${table.capacity === 1 ? "assento" : "assentos"}`
                    : "Assentos não informados"}
                </p>
                {table.active && (
                  <button
                    className="button compact-button"
                    onClick={() => setAttending(table)}
                  >
                    {table.active_tab
                      ? `Ver comanda ${table.active_tab.number}`
                      : "Abrir comanda"}
                  </button>
                )}
                {canEdit && (
                  <button
                    className="text-button"
                    onClick={() => setEditing(table)}
                    aria-label={`Editar mesa ${table.code}`}
                  >
                    Editar mesa →
                  </button>
                )}
              </article>
            ))}
        </div>
      )}
      {cursor && (
        <button
          className="secondary-button load-more"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? "Carregando…" : "Carregar mais mesas"}
        </button>
      )}
      {attending && (
        <TabForm
          tenantId={id}
          table={attending}
          role={restaurant.role}
          onClose={() => setAttending(undefined)}
          onSaved={load}
        />
      )}
      {(adding || editing) && (
        <TableForm
          tenantId={id}
          table={editing}
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
          }}
          onSaved={load}
        />
      )}
      {editingRestaurant && (
        <RestaurantForm
          restaurant={restaurant}
          onClose={() => setEditingRestaurant(false)}
          onPersisted={reload}
          onSaved={() => setEditingRestaurant(false)}
        />
      )}
    </>
  );
}
