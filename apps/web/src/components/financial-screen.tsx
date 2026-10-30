"use client";
import { useLiveRefresh } from "../lib/use-live-refresh";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, message, RequestError } from "../lib/api";
import { methodLabels, money } from "../lib/cash";
import {
  financialDate,
  validateFinancialPeriod,
  type FinancialOverview,
  type FinancialPeriod,
} from "../lib/financial";
import { useWorkspace } from "./workspace-shell";
import { RestaurantFilter } from "./restaurant-filter";
import { FinancialTrend } from "./financial-trend";
import { Icon } from "./icons";

export default function FinancialScreen() {
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
  const [period, setPeriod] = useState<FinancialPeriod>("week");
  const [range, setRange] = useState({ start: "", end: "" });
  const [draft, setDraft] = useState({ start: "", end: "" });
  const [periodError, setPeriodError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{
    key: string;
    result: FinancialOverview;
  }>();
  const key = JSON.stringify([tenantId, period, range.start, range.end]);
  const current = data?.key === key ? data.result : undefined;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!tenantId || (period === "custom" && (!range.start || !range.end)))
        return;
      const params =
        period === "custom"
          ? new URLSearchParams({
              start_date: range.start,
              end_date: range.end,
            })
          : new URLSearchParams({ period });
      const result = await api<FinancialOverview>(
        `/tenants/${tenantId}/reports/financial?${params}`,
        { signal, fresh: true },
      );
      if (!signal.aborted) {
        setData({ key, result });
        setError("");
      }
    },
    [tenantId, period, range.start, range.end, key],
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
    return () => controller.abort();
  }, [load, retry]);
  useLiveRefresh(
    key,
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
    !!tenantId && !loading,
  );
  const hasActivity =
    current &&
    (current.receipts_cents !== 0 ||
      current.refunds_cents !== 0 ||
      current.sales.closed_tabs !== 0 ||
      current.cash.supply_cents !== 0 ||
      current.cash.withdrawal_cents !== 0 ||
      current.cash.closed_sessions !== 0 ||
      current.cash.open_sessions !== 0);
  const methods =
    current?.payments_by_method
      .slice()
      .sort((a, b) => b.receipts_cents - a.receipts_cents) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OS NÚMEROS DO SEU RESTAURANTE</span>
          <h1>Dashboard financeiro</h1>
          <p>Acompanhe suas vendas, recebimentos e movimentações de caixa.</p>
        </div>
        <Link href="/caixa" className="secondary-button financial-cash-link">
          <Icon name="cash" />
          Ir para o caixa
        </Link>
      </div>
      {workspaceLoading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : !restaurant ? (
        <section className="empty-state">
          <span className="step-icon">
            <Icon name="chart" />
          </span>
          <h2>
            {restaurants.length
              ? "Acesso financeiro restrito"
              : "Seu financeiro começa por aqui"}
          </h2>
          <p>
            {workspaceError
              ? "Não foi possível consultar os restaurantes. Tente novamente pelo aviso acima."
              : restaurants.length
                ? "O dashboard está disponível para administradores, gerentes e operadores de caixa."
                : "Cadastre um restaurante para acompanhar seus resultados."}
          </p>
          <Link href="/restaurantes" className="text-button">
            Ver restaurantes →
          </Link>
        </section>
      ) : (
        <>
          <section
            className="financial-toolbar"
            aria-label="Filtros do dashboard financeiro"
          >
            <RestaurantFilter
              restaurants={allowed}
              value={tenantId!}
              onChange={(id) => {
                setSelected(id);
                setPeriod("week");
                setRange({ start: "", end: "" });
                setPeriodError("");
              }}
            />
            <div
              className="financial-periods"
              role="group"
              aria-label="Período do relatório"
            >
              {(
                [
                  ["today", "Hoje"],
                  ["week", "Últimos 7 dias"],
                  ["month", "Este mês"],
                  ["custom", "Personalizado"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={period === value}
                  onClick={() => {
                    setPeriodError("");
                    if (value === "custom" && current) {
                      const dates = {
                        start: current.start_date,
                        end: current.end_date,
                      };
                      setDraft(dates);
                      setRange(dates);
                    }
                    setPeriod(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          {period === "custom" && (
            <form
              className="financial-date-form"
              onSubmit={(event) => {
                event.preventDefault();
                const validation = validateFinancialPeriod(
                  draft.start,
                  draft.end,
                );
                setPeriodError(validation);
                if (!validation) setRange({ ...draft });
              }}
            >
              <label>
                Data inicial
                <input
                  type="date"
                  required
                  value={draft.start}
                  onChange={(event) =>
                    setDraft({ ...draft, start: event.target.value })
                  }
                  aria-describedby={
                    periodError ? "financial-period-error" : undefined
                  }
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  required
                  value={draft.end}
                  onChange={(event) =>
                    setDraft({ ...draft, end: event.target.value })
                  }
                  aria-describedby={
                    periodError ? "financial-period-error" : undefined
                  }
                />
              </label>
              <button className="button compact-button" type="submit">
                Aplicar período
              </button>
              <span className="field-hint">Até 31 dias por consulta.</span>
            </form>
          )}
          {periodError && (
            <p className="error" role="alert" id="financial-period-error">
              {periodError}
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
          {loading ? (
            <div className="financial-loading" role="status">
              <Icon name="chart" />
              <p>Preparando os resultados do período…</p>
            </div>
          ) : current ? (
            <>
              <div className="financial-period-note">
                <span>
                  <strong>{restaurant.name}</strong> ·{" "}
                  {financialDate(current.start_date)} a{" "}
                  {financialDate(current.end_date)}
                </span>
                <span>Dias operacionais · {current.timezone}</span>
              </div>
              <div className="stock-summary cash-summary financial-summary">
                {[
                  {
                    label: "Recebimentos líquidos",
                    amount: current.net_received_cents,
                    hint: "Recebimentos menos estornos",
                    featured: true,
                  },
                  {
                    label: "Vendas fechadas",
                    amount: current.sales.sales_cents,
                    hint: `${current.sales.closed_tabs} ${current.sales.closed_tabs === 1 ? "comanda encerrada" : "comandas encerradas"}`,
                  },
                  {
                    label: "Ticket médio",
                    amount: current.average_ticket_cents,
                    hint: "Por comanda encerrada",
                  },
                  {
                    label: "Estornos",
                    amount: current.refunds_cents,
                    hint: "Devoluções no período",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`stock-stat financial-stat${item.featured ? " financial-stat-featured" : ""}`}
                  >
                    <span>{item.label}</span>
                    <strong>{money(item.amount)}</strong>
                    <small>{item.hint}</small>
                  </div>
                ))}
              </div>
              {!hasActivity && (
                <div className="financial-empty-note">
                  <Icon name="chart" />
                  <div>
                    <strong>Nenhuma movimentação no período</strong>
                    <p>
                      As vendas e os recebimentos aparecerão aqui conforme a
                      operação do restaurante.
                    </p>
                  </div>
                </div>
              )}
              <div className="financial-main-grid">
                <FinancialTrend days={current.days} />
                <section
                  className="financial-panel"
                  aria-labelledby="financial-methods-heading"
                >
                  <span className="eyebrow">COMO SEUS CLIENTES PAGAM</span>
                  <h2 id="financial-methods-heading">Formas de pagamento</h2>
                  <p className="financial-panel-helper">
                    Participação nos recebimentos brutos.
                  </p>
                  {methods.length ? (
                    <ul className="financial-methods">
                      {methods.map((method, index) => {
                        const share =
                          current.receipts_cents > 0
                            ? (method.receipts_cents / current.receipts_cents) *
                              100
                            : 0;
                        return (
                          <li key={method.method}>
                            <div>
                              <span>
                                <i
                                  className={`financial-method-dot method-${index % 5}`}
                                  aria-hidden="true"
                                />
                                {methodLabels[method.method] ?? method.method}
                              </span>
                              <strong>{money(method.receipts_cents)}</strong>
                            </div>
                            <div
                              className="financial-method-track"
                              aria-hidden="true"
                            >
                              <span
                                className={`method-${index % 5}`}
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <small>
                              {share.toLocaleString("pt-BR", {
                                maximumFractionDigits: 1,
                              })}
                              %
                              {method.refunds_cents > 0 &&
                                ` · Estornos: ${money(method.refunds_cents)}`}
                            </small>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="financial-inline-empty">
                      Nenhum pagamento registrado neste período.
                    </p>
                  )}
                  <div className="financial-panel-total">
                    <span>Total recebido bruto</span>
                    <strong>{money(current.receipts_cents)}</strong>
                  </div>
                </section>
              </div>
              <div className="financial-secondary-grid">
                <section
                  className="financial-panel"
                  aria-labelledby="financial-sales-heading"
                >
                  <span className="eyebrow">COMPOSIÇÃO DAS VENDAS</span>
                  <h2 id="financial-sales-heading">Do consumo ao fechamento</h2>
                  <dl className="financial-breakdown">
                    <div>
                      <dt>Consumo</dt>
                      <dd>{money(current.sales.subtotal_cents)}</dd>
                    </div>
                    <div>
                      <dt>Descontos</dt>
                      <dd className="cash-out">
                        − {money(current.sales.discount_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Taxa de serviço</dt>
                      <dd>+ {money(current.sales.service_cents)}</dd>
                    </div>
                    <div className="financial-breakdown-total">
                      <dt>Total de vendas fechadas</dt>
                      <dd>{money(current.sales.sales_cents)}</dd>
                    </div>
                  </dl>
                </section>
                <section
                  className="financial-panel"
                  aria-labelledby="financial-cash-heading"
                >
                  <span className="eyebrow">CONTROLE DO DINHEIRO</span>
                  <h2 id="financial-cash-heading">Movimentações de caixa</h2>
                  <dl className="financial-breakdown">
                    <div>
                      <dt>Suprimentos</dt>
                      <dd className="cash-in">
                        + {money(current.cash.supply_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Sangrias</dt>
                      <dd className="cash-out">
                        − {money(current.cash.withdrawal_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Diferença dos turnos fechados</dt>
                      <dd
                        className={
                          current.cash.difference_cents < 0 ? "cash-out" : ""
                        }
                      >
                        {money(current.cash.difference_cents)}
                      </dd>
                    </div>
                  </dl>
                  <p className="financial-panel-helper">
                    {current.cash.closed_sessions}{" "}
                    {current.cash.closed_sessions === 1
                      ? "turno fechado"
                      : "turnos fechados"}{" "}
                    · {current.cash.open_sessions} em andamento no período.
                    Suprimentos e sangrias não compõem as vendas.
                  </p>
                </section>
              </div>
              <section
                className="financial-panel financial-daily"
                aria-labelledby="financial-daily-heading"
              >
                <div className="financial-panel-heading">
                  <div>
                    <span className="eyebrow">CADA DIA CONTA</span>
                    <h2 id="financial-daily-heading">Detalhamento diário</h2>
                  </div>
                  <span className="financial-day-count">
                    {current.days.length}{" "}
                    {current.days.length === 1 ? "dia" : "dias"}
                  </span>
                </div>
                <div className="stock-table-wrap">
                  <table className="stock-table financial-daily-table">
                    <caption className="sr-only">
                      Resultados financeiros por dia operacional
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Dia</th>
                        <th scope="col">Comandas fechadas</th>
                        <th scope="col">Vendas fechadas</th>
                        <th scope="col">Recebimentos brutos</th>
                        <th scope="col">Estornos</th>
                        <th scope="col">Recebimentos líquidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.days.map((day) => (
                        <tr key={day.business_date}>
                          <th scope="row">
                            {financialDate(day.business_date)}
                          </th>
                          <td>{day.closed_tabs}</td>
                          <td>{money(day.sales_cents)}</td>
                          <td>{money(day.receipts_cents)}</td>
                          <td>{money(day.refunds_cents)}</td>
                          <td
                            className={
                              day.net_received_cents < 0 ? "cash-out" : ""
                            }
                          >
                            {money(day.net_received_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Total do período</th>
                        <td>{current.sales.closed_tabs}</td>
                        <td>{money(current.sales.sales_cents)}</td>
                        <td>{money(current.receipts_cents)}</td>
                        <td>{money(current.refunds_cents)}</td>
                        <td>{money(current.net_received_cents)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
              <p className="financial-footnote">
                Vendas seguem o dia operacional da comanda; recebimentos e
                movimentações seguem o dia operacional do turno de caixa. Os
                valores podem ser diferentes. Este é um relatório operacional
                não fiscal.
              </p>
            </>
          ) : (
            !error && (
              <p className="helper">
                Selecione as datas e aplique o período para consultar os
                resultados.
              </p>
            )
          )}
        </>
      )}
    </>
  );
}
