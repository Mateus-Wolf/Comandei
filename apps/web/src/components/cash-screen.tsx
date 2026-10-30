"use client";
import { useLiveRefresh } from "../lib/use-live-refresh";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FormLoading } from "./form-loading";
import { api, message, RequestError } from "../lib/api";
import { cashDate, type CashOverview, type CashTab } from "../lib/cash";
import { useWorkspace } from "./workspace-shell";
import { RestaurantFilter } from "./restaurant-filter";
import { CashSummary } from "./cash-summary";
import type { CashAction } from "./cash-action-form";
import { Icon } from "./icons";
const CashActionForm = dynamic(
  () => import("./cash-action-form").then((module) => module.CashActionForm),
  { loading: FormLoading },
);
const CashCheckout = dynamic(
  () => import("./cash-checkout").then((module) => module.CashCheckout),
  { loading: FormLoading },
);
export default function CashScreen() {
  const {
    restaurants,
    loading: workspaceLoading,
    error: workspaceError,
  } = useWorkspace();
  const allowed = restaurants.filter((item) =>
    ["owner", "manager", "cashier"].includes(item.role),
  );
  const [selected, setSelected] = useState("");
  const restaurant = allowed.find((item) => item.id === selected) ?? allowed[0];
  const tenantId = restaurant?.id;
  const [sessionId, setSessionId] = useState("");
  const [search, setSearch] = useState("");
  const [tabSearch, setTabSearch] = useState("");
  const [data, setData] = useState<{
    tenantId: string;
    sessionId: string;
    result: CashOverview;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [action, setAction] = useState<{
    kind: CashAction;
    snapshot: CashOverview;
  }>();
  const [checkout, setCheckout] = useState<CashTab>();
  const sequence = useRef(0);
  const pinnedSessions = useRef(new Map<string, string>());
  useEffect(() => {
    const timer = setTimeout(() => setTabSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!tenantId) return;
      const request = ++sequence.current;
      const query = new URLSearchParams({ tab_search: tabSearch });
      const targetSession = sessionId || pinnedSessions.current.get(tenantId);
      if (targetSession) query.set("session_id", targetSession);
      const result = await api<CashOverview>(
        `/tenants/${tenantId}/cash-overview?${query}`,
        { signal, fresh: true },
      );
      if (!signal?.aborted && request === sequence.current) {
        if (!sessionId && result.session)
          pinnedSessions.current.set(tenantId, result.session.id);
        setData({ tenantId, sessionId, result });
        setError("");
      }
    },
    [tenantId, sessionId, tabSearch],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
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
  const current =
    data && data.tenantId === tenantId && data.sessionId === sessionId
      ? data.result
      : undefined;
  useLiveRefresh(
    JSON.stringify([tenantId, sessionId, tabSearch]),
    async (signal) => {
      try {
        await load(signal);
      } catch (e) {
        if (!signal.aborted) {
          if (e instanceof RequestError && [401, 403].includes(e.status))
            setData(undefined);
          setError(message(e));
        }
      }
    },
    !!tenantId && !loading && !action && !checkout,
  );
  const session = current?.session;
  const canManage =
    restaurant?.role === "owner" || restaurant?.role === "manager";
  const available = current?.registers.some(
    (item) => item.active && !item.occupied,
  );
  function openAction(kind: CashAction) {
    if (current) setAction({ kind, snapshot: current });
  }
  async function saved(newSession?: string) {
    setNotice("Operação de caixa registrada com sucesso.");
    if (newSession) setSessionId(newSession);
    else await load();
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DO ATENDIMENTO AO FECHAMENTO</span>
          <h1>Caixa</h1>
          <p>Acompanhe o turno, os recebimentos e o dinheiro da unidade.</p>
        </div>
        <div className="heading-actions">
          {canManage && (
            <button
              type="button"
              className="secondary-button"
              disabled={!current || restaurant?.status !== "active"}
              onClick={() => openAction("register")}
            >
              Novo terminal
            </button>
          )}
          <button
            type="button"
            className="button compact-button"
            disabled={!current || !available || restaurant?.status !== "active"}
            onClick={() => openAction("open")}
          >
            <Icon name="plus" />
            Abrir turno
          </button>
        </div>
      </div>
      {workspaceLoading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : !restaurant ? (
        <section className="empty-state">
          <span className="step-icon">
            <Icon name="cash" />
          </span>
          <h2>
            {restaurants.length
              ? "Acesso ao caixa restrito"
              : "Comece por um restaurante"}
          </h2>
          <p>
            {workspaceError
              ? "Não foi possível consultar seus restaurantes. Tente novamente pelo aviso acima."
              : restaurants.length
                ? "Esta tela é destinada a administradores, gerentes e operadores de caixa."
                : "Cadastre uma unidade para organizar seus turnos de caixa."}
          </p>
          <Link className="text-button" href="/restaurantes">
            Ver restaurantes →
          </Link>
        </section>
      ) : (
        <>
          <section className="team-toolbar" aria-label="Filtros do caixa">
            <RestaurantFilter
              restaurants={allowed}
              value={tenantId!}
              onChange={(id) => {
                pinnedSessions.current.delete(id);
                setSelected(id);
                setSessionId("");
                setSearch("");
                setTabSearch("");
                setAction(undefined);
                setCheckout(undefined);
                setNotice("");
              }}
            />
            <label>
              Turnos recentes <span className="optional">(até 20)</span>
              <select
                value={current?.session?.id ?? ""}
                disabled={!current?.sessions.length}
                onChange={(event) => {
                  setSessionId(event.target.value);
                  setNotice("");
                }}
              >
                <option value="" disabled>
                  {loading ? "Carregando turnos…" : "Nenhum turno disponível"}
                </option>
                {current?.sessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.register_name} ·{" "}
                    {item.status === "open" ? "Aberto" : "Fechado"} ·{" "}
                    {cashDate(item.opened_at, current.timezone)}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <div className="cash-toolbar">
            <p className="field-hint">
              {restaurant.role === "cashier"
                ? "Você pode consultar e operar apenas os seus turnos."
                : "Você pode consultar os turnos desta unidade."}
            </p>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => setRetry((value) => value + 1)}
            >
              {loading ? "Atualizando…" : "Atualizar caixa"}
            </button>
          </div>
          {restaurant.status !== "active" && (
            <p className="read-only-note">
              Esta unidade está suspensa. Novos turnos estão indisponíveis; os
              turnos existentes podem ser concluídos.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="cash-success" role="status">
              {notice}
            </p>
          )}
          {loading && !current ? (
            <p role="status">Carregando caixa…</p>
          ) : (
            current && (
              <>
                {session ? (
                  <>
                    <div className="cash-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={session.status !== "open"}
                        onClick={() => openAction("supply")}
                      >
                        Registrar suprimento
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={session.status !== "open"}
                        onClick={() => openAction("withdrawal")}
                      >
                        Registrar sangria
                      </button>
                      <button
                        type="button"
                        className="button compact-button"
                        disabled={session.status !== "open"}
                        onClick={() => openAction("close")}
                      >
                        Fechar turno
                      </button>
                    </div>
                    <CashSummary data={current} />
                  </>
                ) : (
                  <section className="empty-state">
                    <span className="step-icon">
                      <Icon name="cash" />
                    </span>
                    <h2>
                      {current.registers.length
                        ? "Nenhum turno para consultar"
                        : "Prepare o primeiro caixa"}
                    </h2>
                    <p>
                      {!current.registers.length
                        ? canManage
                          ? "Cadastre um terminal para abrir o primeiro turno."
                          : "Solicite ao administrador o cadastro de um terminal de caixa."
                        : available
                          ? "Abra um turno em um terminal livre para começar a receber."
                          : "Os terminais estão ocupados ou inativos. Consulte o responsável pela unidade."}
                    </p>
                  </section>
                )}
                <section className="cash-tabs">
                  <div className="section-heading">
                    <div>
                      <h2>Comandas em atendimento</h2>
                      <p className="helper">
                        Exibindo até 50 comandas. Busque pelo número da comanda
                        ou da mesa.
                      </p>
                    </div>
                  </div>
                  <label className="cash-search">
                    Buscar comanda
                    <input
                      type="search"
                      maxLength={80}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Número da comanda ou mesa"
                    />
                  </label>
                  {loading || search.trim() !== tabSearch ? (
                    <p role="status">Atualizando comandas…</p>
                  ) : current.tabs.length ? (
                    <div className="cash-tab-grid">
                      {current.tabs.map((tab) => (
                        <article className="cash-tab-card" key={tab.id}>
                          <div>
                            <h3>Comanda {tab.number}</h3>
                            <p>
                              {tab.table_code
                                ? `Mesa ${tab.table_code}`
                                : "Sem mesa"}
                            </p>
                            <span
                              className={`team-status ${tab.status === "closing" ? "blocked" : "active"}`}
                            >
                              {tab.status === "closing"
                                ? "Em fechamento"
                                : "Aberta"}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setCheckout(tab)}
                          >
                            {tab.status === "closing"
                              ? "Receber →"
                              : "Conferir →"}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="helper">Nenhuma comanda encontrada.</p>
                  )}
                </section>
              </>
            )
          )}
          {action && current && (
            <CashActionForm
              key={`${tenantId}:${action.kind}`}
              action={action.kind}
              tenantId={tenantId!}
              data={action.snapshot}
              onClose={() => setAction(undefined)}
              onSaved={saved}
            />
          )}
          {checkout && current && (
            <CashCheckout
              key={`${tenantId}:${checkout.id}`}
              tenantId={tenantId!}
              tabId={checkout.id}
              session={session ?? null}
              onClose={() => setCheckout(undefined)}
              onSaved={() => load()}
            />
          )}
        </>
      )}
    </>
  );
}
