"use client";
import { useEffect, useRef, useState } from "react";
import { api, message, RequestError } from "../lib/api";
import { useWorkspace } from "./workspace-shell";
import { RestaurantFilter } from "./restaurant-filter";
import { useLiveRefresh } from "../lib/use-live-refresh";

type Approval = {
  id: string;
  action: string;
  status: string;
  resource_id: string;
  requested_by: string;
  created_at: string;
  expires_at: string;
  payload: { reason?: string; amount_cents?: number; tab_id?: string };
};
type Page = { items: Approval[]; next_cursor: string | null };
const money = (value: number) =>
  (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ApprovalsScreen() {
  const { restaurants, loading } = useWorkspace();
  const allowed = restaurants.filter(
    (r) => r.role === "owner" || r.role === "manager",
  );
  const [selected, setSelected] = useState("");
  const restaurant = allowed.find((r) => r.id === selected) ?? allowed[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Aprovações</h1>
          <p>Confira descontos e cancelamentos solicitados pela equipe.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : !restaurant ? (
        <section className="empty-state">
          <h2>Acesso restrito</h2>
          <p>Somente gerentes e administradores podem aprovar solicitações.</p>
        </section>
      ) : (
        <>
          <RestaurantFilter
            restaurants={allowed}
            value={restaurant.id}
            onChange={setSelected}
          />
          <ApprovalList key={restaurant.id} tenantId={restaurant.id} />
        </>
      )}
    </>
  );
}

function ApprovalList({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmation, setConfirmation] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const active = useRef(false);
  const submitting = useRef(false);
  const keys = useRef(new Map<string, string>());
  const path = `/tenants/${tenantId}/approvals`;
  async function refresh(signal: AbortSignal) {
    try {
      const result: Approval[] = [];
      let cursor: string | null = null;
      do {
        const page: Page = await api<Page>(
          `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          { signal, fresh: true },
        );
        result.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor && !signal.aborted);
      if (!signal.aborted) {
        setItems(result);
        setNow(Date.now());
        setError("");
      }
    } catch (e) {
      if (!signal.aborted) {
        setError(message(e));
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setItems([]);
          setConfirmation(undefined);
        }
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active.current = false;
      controller.abort();
      window.clearInterval(timer);
    };
    // The list is remounted when the restaurant changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, retry]);
  useLiveRefresh(path, refresh, !busy && !confirmation);
  async function approve(item: Approval) {
    if (submitting.current || Date.parse(item.expires_at) <= Date.now()) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    const key = keys.current.get(item.id) ?? crypto.randomUUID();
    keys.current.set(item.id, key);
    try {
      await api(`${path}/${item.id}/approve`, {
        method: "POST",
        body: {},
        key,
      });
      if (!active.current) return;
      setItems((old) => old.filter((row) => row.id !== item.id));
      setSuccess("Solicitação aprovada e aplicada com sucesso.");
      setConfirmation(undefined);
      keys.current.delete(item.id);
    } catch (e) {
      if (!active.current) return;
      setError(message(e));
      if (e instanceof RequestError && [401, 403].includes(e.status))
        setItems([]);
      if (e instanceof RequestError && [404, 409].includes(e.status)) {
        setConfirmation(undefined);
        setRetry((value) => value + 1);
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }
  const pending = items
    .filter(
      (item) => item.status === "pending" && Date.parse(item.expires_at) > now,
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return (
    <section aria-label="Solicitações pendentes">
      <div className="section-heading">
        <h2>Pendentes ({pending.length})</h2>
        <button
          className="secondary-button"
          disabled={busy || loading}
          onClick={() => {
            setConfirmation(undefined);
            setRetry((value) => value + 1);
          }}
        >
          Atualizar
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
      {loading ? (
        <p role="status">Buscando solicitações…</p>
      ) : pending.length === 0 ? (
        <div className="empty-state">
          <h2>Nenhuma solicitação pendente</h2>
          <p>Solicitações executadas ou expiradas não aparecem nesta lista.</p>
        </div>
      ) : (
        pending.map((item) => (
          <article className="empty-state" key={item.id}>
            <h3>
              {item.action === "tabs.discount"
                ? `Desconto de ${money(item.payload.amount_cents ?? 0)}`
                : item.action === "items.cancel"
                  ? "Cancelamento de item"
                  : "Solicitação desconhecida"}
            </h3>
            <p>Motivo: {item.payload.reason || "Não informado"}</p>
            <p>
              Referência{" "}
              {item.action === "tabs.discount" ? "da comanda" : "do item"}:{" "}
              {item.resource_id}
            </p>
            {confirmation === item.id && (
              <ApprovalContext tenantId={tenantId} item={item} />
            )}
            <p>Solicitante: {item.requested_by}</p>
            <p>
              Solicitada em {new Date(item.created_at).toLocaleString("pt-BR")}{" "}
              · Expira em{" "}
              {new Date(item.expires_at).toLocaleTimeString("pt-BR")}
            </p>
            {confirmation === item.id ? (
              <div>
                <p>
                  A aprovação aplicará esta alteração à conta. Deseja confirmar?
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void approve(item)}
                >
                  {busy ? "Aplicando…" : "Confirmar aprovação"}
                </button>{" "}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setConfirmation(undefined)}
                >
                  Voltar
                </button>
              </div>
            ) : (
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !["tabs.discount", "items.cancel"].includes(item.action)
                }
                onClick={() => {
                  setSuccess("");
                  setConfirmation(item.id);
                }}
              >
                Revisar aprovação
              </button>
            )}
          </article>
        ))
      )}
    </section>
  );
}

function ApprovalContext({
  tenantId,
  item,
}: {
  tenantId: string;
  item: Approval;
}) {
  const [context, setContext] = useState("");
  const tabId =
    item.action === "tabs.discount" ? item.resource_id : item.payload.tab_id;
  useEffect(() => {
    const controller = new AbortController();
    if (tabId)
      void api<{
        number: number;
        orders: {
          items: { id: string; name_snapshot: string; quantity: string }[];
        }[];
      }>(`/tenants/${tenantId}/tabs/${tabId}`, {
        signal: controller.signal,
        fresh: true,
      })
        .then((tab) => {
          if (controller.signal.aborted) return;
          const product = tab.orders
            .flatMap((order) => order.items)
            .find((product) => product.id === item.resource_id);
          setContext(
            `Comanda nº ${tab.number}${product ? ` · ${product.quantity} × ${product.name_snapshot}` : ""}`,
          );
        })
        .catch((e) => {
          if (!controller.signal.aborted) setContext(message(e));
        });
    return () => controller.abort();
  }, [tenantId, tabId, item.resource_id]);
  return <p role="status">{context || "Consultando comanda…"}</p>;
}
