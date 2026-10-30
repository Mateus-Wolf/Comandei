"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api, message, RequestError, type DiningTable } from "../lib/api";
import { filterTables, tableStatus, tableStatusLabels } from "../lib/tables";
import { useWorkspace } from "./workspace-shell";
import { RestaurantFilter } from "./restaurant-filter";
import { Icon } from "./icons";
import { FormLoading } from "./form-loading";
const TabForm = dynamic(
  () => import("./tab-form").then((module) => module.TabForm),
  { loading: FormLoading },
);

export default function TablesDashboard() {
  const {
    restaurants,
    loading: workspaceLoading,
    error: workspaceError,
  } = useWorkspace();
  const [selected, setSelected] = useState("");
  const restaurant =
    restaurants.find((item) => item.id === selected) ?? restaurants[0];
  const tenantId = restaurant?.id;
  const [snapshot, setSnapshot] = useState<{
    tenantId: string;
    tables: DiningTable[];
    updated: Date;
  }>();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attending, setAttending] = useState<DiningTable>();
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!tenantId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const tables: DiningTable[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: DiningTable[]; next_cursor: string | null } =
          await api(
            `/tenants/${tenantId}/tables?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            { signal: controller.signal, fresh: true },
          );
        tables.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor && !controller.signal.aborted);
      if (!controller.signal.aborted) {
        setSnapshot({ tenantId, tables, updated: new Date() });
        setError("");
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof RequestError && [401, 403].includes(err.status))
          setSnapshot(undefined);
        setError(message(err));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [tenantId]);
  useEffect(() => {
    setSearch("");
    setStatus("");
    setAttending(undefined);
    setError("");
    void load();
    return () => request.current?.abort();
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !attending && !loading)
        void load();
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load, loading, attending]);
  const current = snapshot?.tenantId === tenantId ? snapshot : undefined;
  const tables = current?.tables ?? [];
  const visible = filterTables(tables, search, status);
  if (workspaceLoading)
    return <p role="status">Carregando seus restaurantes…</p>;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACOMPANHE O SALÃO</span>
          <h1>Dashboard de mesas</h1>
          <p>Do início do atendimento à liberação da mesa.</p>
        </div>
        <button
          className="secondary-button"
          disabled={!tenantId || loading}
          onClick={() => void load()}
        >
          {loading ? "Atualizando…" : "Atualizar mesas"}
        </button>
      </div>
      {!restaurant ? (
        <div className="empty-state">
          <h2>
            {workspaceError
              ? "Não foi possível carregar seus acessos"
              : "Nenhum restaurante disponível"}
          </h2>
          <p>
            {workspaceError ||
              "Solicite ao responsável um vínculo com a equipe para acompanhar as mesas."}
          </p>
        </div>
      ) : (
        <>
          <div className="tables-dashboard-toolbar">
            <RestaurantFilter
              restaurants={restaurants}
              value={restaurant.id}
              onChange={(id) => {
                request.current?.abort();
                setAttending(undefined);
                setSelected(id);
              }}
            />
            <label>
              Buscar mesa ou comanda
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Número, nome ou comanda"
              />
            </label>
            <label>
              Situação
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Todas</option>
                {Object.entries(tableStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="read-only-note">
            Atualização automática a cada 15 segundos com esta tela visível.{" "}
            {current &&
              `Última atualização: ${current.updated.toLocaleTimeString("pt-BR")}.`}{" "}
            {attending && "Atualização pausada enquanto a comanda está aberta."}
          </p>
          {error && (
            <div className="error" role="alert">
              {error}{" "}
              {current &&
                "Os dados exibidos são da última atualização concluída."}
              <button
                className="text-button"
                disabled={loading}
                onClick={() => void load()}
              >
                Tentar novamente
              </button>
            </div>
          )}
          <div
            className="tables-dashboard-summary"
            aria-label="Resumo das mesas"
          >
            {Object.entries(tableStatusLabels).map(([key, label]) => (
              <div className={`tables-metric ${key}`} key={key}>
                <span>{label}</span>
                <strong>
                  {current
                    ? tables.filter((table) => tableStatus(table) === key)
                        .length
                    : "—"}
                </strong>
              </div>
            ))}
          </div>
          {!current ? (
            <p role="status">
              {loading
                ? "Carregando mesas…"
                : "Aguardando atualização das mesas."}
            </p>
          ) : !visible.length ? (
            <div className="empty-state">
              <h2>
                {tables.length
                  ? "Nenhuma mesa encontrada"
                  : "Nenhuma mesa cadastrada"}
              </h2>
              <p>
                {tables.length
                  ? "Ajuste a busca ou o filtro de situação."
                  : "O administrador pode cadastrar mesas na área de restaurantes."}
              </p>
            </div>
          ) : (
            <div className="table-grid">
              {visible.map((table) => {
                const state = tableStatus(table);
                return (
                  <article
                    key={table.id}
                    className={`table-card monitor-table ${state}`}
                  >
                    <div className="table-card-top">
                      <span className="table-drawing">
                        <Icon name="table" />
                      </span>
                      <span className={`table-status ${state}`}>
                        {tableStatusLabels[state]}
                      </span>
                    </div>
                    <h2>Mesa {table.code}</h2>
                    <p>{table.name}</p>
                    <p>
                      {table.capacity
                        ? `${table.capacity} assentos`
                        : "Capacidade não informada"}
                    </p>
                    <p className="monitor-tab-number">
                      {table.active_tab
                        ? `Comanda ${table.active_tab.number}`
                        : "Sem comanda ativa"}
                    </p>
                    {table.active && (
                      <button
                        className="button compact-button"
                        onClick={() => setAttending(table)}
                        disabled={
                          !table.active_tab && restaurant.status !== "active"
                        }
                      >
                        {state === "open"
                          ? "Ver comanda / lançar itens"
                          : table.active_tab
                            ? "Ver comanda"
                            : "Abrir comanda"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {["owner", "manager", "cashier"].includes(restaurant.role) && (
            <p>
              <Link className="text-button" href="/caixa">
                Ir para recebimentos no caixa →
              </Link>
            </p>
          )}
          {attending && (
            <TabForm
              key={`${tenantId}:${attending.id}`}
              tenantId={restaurant.id}
              table={attending}
              role={restaurant.role}
              onClose={() => {
                setAttending(undefined);
                void load();
              }}
              onSaved={load}
            />
          )}
        </>
      )}
    </>
  );
}
