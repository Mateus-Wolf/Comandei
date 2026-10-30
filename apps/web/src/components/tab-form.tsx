"use client";
import { useLiveRefresh } from "../lib/use-live-refresh";
import { useEffect, useRef, useState } from "react";
import { api, message, RequestError, type DiningTable } from "../lib/api";
import { Dialog } from "./dialog";

type Product = {
  modifier_groups?: {
    id: string;
    name: string;
    min_choices: number;
    max_choices: number;
    options: { id: string; name: string; price_cents: number }[];
  }[];
  id: string;
  name: string;
  price_cents: number;
  version: number;
  active: boolean;
  available: boolean;
  category_id: string;
  unit: string;
};
type Guest = {
  product_id: string | null;
  quantity: number;
  complimentary: boolean;
  label: string;
  name_snapshot?: string;
  unit_price_cents?: number;
};
type Tab = {
  id: string;
  number: number;
  status: string;
  version: number;
  guests: Guest[];
  service_accepted: boolean;
  amounts: { total_cents: number; balance_cents: number };
  orders: {
    id: string;
    sequence: number;
    items: {
      id: string;
      name_snapshot: string;
      quantity: string;
      status: string;
      unit_price_cents: number;
      modifiers: {
        name_snapshot: string;
        quantity: string;
        unit_price_cents: number;
      }[];
    }[];
  }[];
};
const money = (value: number) =>
  (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
async function collection<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const result: { items: T[]; next_cursor: string | null } = await api(
      `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    all.push(...result.items);
    cursor = result.next_cursor;
  } while (cursor);
  return all;
}

export function TabForm({
  tenantId,
  table,
  role,
  onClose,
  onSaved,
}: {
  tenantId: string;
  table: DiningTable;
  role: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const base = `/tenants/${tenantId}`;
  const [tab, setTab] = useState<Tab>();
  const [products, setProducts] = useState<Product[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [settings, setSettings] = useState<{
    version: number;
    tab_reopen_roles: string[];
  }>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [guestReason, setGuestReason] = useState("");
  const [productId, setProductId] = useState("");
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [service, setService] = useState(true);
  const [draft, setDraft] = useState<
    {
      product_id: string;
      catalog_version: number;
      quantity: string;
      notes: string | null;
      name: string;
      price: number;
      modifier_option_ids: string[];
      modifier_names: string;
    }[]
  >([]);
  const mutation = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  async function refresh(id: string) {
    const detail = await api<Tab>(`${base}/tabs/${id}`, { fresh: true });
    setTab(detail);
    setGuests(detail.guests);
    setService(detail.service_accepted);
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [items, categories, config, detail] = await Promise.all([
          collection<Product>(`${base}/catalog`),
          collection<{ id: string; active: boolean }>(`${base}/categories`),
          api<{ version: number; tab_reopen_roles: string[] }>(
            `${base}/settings`,
          ),
          table.active_tab
            ? api<Tab>(`${base}/tabs/${table.active_tab.id}`, { fresh: true })
            : Promise.resolve(undefined),
        ]);
        if (!active) return;
        setProducts(
          items.filter(
            (p) =>
              p.active &&
              p.available &&
              categories.some((c) => c.id === p.category_id && c.active),
          ),
        );
        setSettings(config);
        setTab(detail);
        setGuests(detail?.guests ?? []);
        setService(detail?.service_accepted ?? true);
      } catch (err) {
        if (active) setError(message(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [base, table.active_tab]);
  const occupied = guests.reduce((sum, g) => sum + g.quantity, 0);
  const dirty =
    JSON.stringify(
      guests.map(({ product_id, quantity, complimentary, label }) => ({
        product_id,
        quantity,
        complimentary,
        label,
      })),
    ) !==
    JSON.stringify(
      (tab?.guests ?? []).map(
        ({ product_id, quantity, complimentary, label }) => ({
          product_id,
          quantity,
          complimentary,
          label,
        }),
      ),
    );
  const open = !tab || tab.status === "open";
  useLiveRefresh(
    tab ? `${base}/tabs/${tab.id}` : undefined,
    async (signal) => {
      try {
        const detail = await api<Tab>(`${base}/tabs/${tab!.id}`, {
          signal,
          fresh: true,
        });
        if (!signal.aborted) {
          setTab(detail);
          setGuests(detail.guests);
          setService(detail.service_accepted);
          setError("");
        }
      } catch (e) {
        if (!signal.aborted) {
          if (e instanceof RequestError && [401, 403].includes(e.status))
            onClose();
          else setError(message(e));
        }
      }
    },
    !loading &&
      !busy &&
      !dirty &&
      !draft.length &&
      !notes &&
      service === tab?.service_accepted,
  );
  async function run(
    path: string,
    body: unknown,
    method = "POST",
    success = "Dados salvos.",
  ) {
    if (busy) return;
    const signature = JSON.stringify({ path, body, method });
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ id?: string }>(path, {
        method,
        body,
        key: mutation.current.key,
      });
      mutation.current = undefined;
      if (path.endsWith("/settings"))
        setSettings(await api(`${base}/settings`));
      else {
        await refresh(tab?.id ?? result.id!);
        if (path.endsWith("/orders")) setDraft([]);
        await onSaved();
      }
      setNotice(success);
    } catch (err) {
      setError(message(err));
      if (tab) {
        try {
          await refresh(tab.id);
          await onSaved();
        } catch {
          /* Preserve the original error. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  function changeGuest(index: number, patch: Partial<Guest>) {
    setGuests((current) =>
      current.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    );
  }
  return (
    <Dialog
      title={`Mesa ${table.code}${tab ? ` · Comanda ${tab.number}` : " · Abrir comanda"}`}
      onClose={onClose}
      busy={busy}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Carregando comanda…</p>
      ) : (
        <>
          <p>
            {tab
              ? {
                  open: "Em atendimento",
                  closing: "Fechada para consumo · Aguardando caixa",
                  closed: "Encerrada",
                  cancelled: "Cancelada",
                }[tab.status]
              : "Selecione os rodízios e as pessoas. Lugares vazios não são cobrados."}
          </p>
          <fieldset disabled={busy || !open} className="tab-section">
            <legend>Pessoas e rodízios</legend>
            <p>
              {occupied} pessoas
              {table.capacity
                ? ` · ${Math.max(0, table.capacity - occupied)} lugares vazios de ${table.capacity}`
                : ""}
            </p>
            {guests.map((guest, index) => (
              <div className="tab-guest" key={index}>
                <label>
                  Identificação
                  <input
                    value={guest.label}
                    maxLength={160}
                    onChange={(e) =>
                      changeGuest(index, { label: e.target.value })
                    }
                    placeholder="Pagantes / Aniversariante"
                  />
                </label>
                <label>
                  Rodízio
                  <select
                    value={guest.product_id ?? ""}
                    onChange={(e) =>
                      changeGuest(index, { product_id: e.target.value || null })
                    }
                  >
                    <option value="">
                      {guest.complimentary
                        ? "Sem cobrança"
                        : "Selecione no catálogo"}
                    </option>
                    {guest.product_id &&
                      !products.some((p) => p.id === guest.product_id) && (
                        <option value={guest.product_id}>
                          {guest.name_snapshot}
                        </option>
                      )}
                    {products.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name} · {money(p.price_cents)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Pessoas
                  <input
                    type="number"
                    min={1}
                    max={table.capacity ?? 1000}
                    value={guest.quantity}
                    onChange={(e) =>
                      changeGuest(index, { quantity: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={guest.complimentary}
                    onChange={(e) =>
                      changeGuest(index, { complimentary: e.target.checked })
                    }
                  />{" "}
                  Cortesia (não paga)
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setGuests((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remover grupo
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setGuests((current) => [
                  ...current,
                  {
                    product_id: null,
                    quantity: 1,
                    complimentary: false,
                    label: "Pagantes",
                  },
                ])
              }
            >
              Adicionar grupo de pessoas
            </button>
            {tab && (
              <label>
                Motivo da redução de cobrança (gerente ou administrador)
                <input
                  value={guestReason}
                  onChange={(event) => setGuestReason(event.target.value)}
                  maxLength={500}
                />
              </label>
            )}
            <button
              type="button"
              className="button"
              disabled={
                !settings ||
                (tab && !dirty) ||
                occupied > (table.capacity ?? Infinity) ||
                guests.some(
                  (g) =>
                    !g.label.trim() ||
                    !Number.isInteger(g.quantity) ||
                    g.quantity < 1 ||
                    (!g.complimentary && !g.product_id),
                )
              }
              onClick={() =>
                void run(
                  tab ? `${base}/tabs/${tab.id}/guests` : `${base}/tabs`,
                  tab
                    ? {
                        expected_version: tab.version,
                        reason: guestReason.trim() || null,
                        guests: guests.map(
                          ({ product_id, quantity, complimentary, label }) => ({
                            product_id,
                            quantity,
                            complimentary,
                            label,
                          }),
                        ),
                      }
                    : { table_id: table.id, guests },
                  tab ? "PUT" : "POST",
                  tab ? "Pessoas atualizadas." : "Comanda aberta.",
                )
              }
            >
              {tab ? "Salvar pessoas" : "Abrir comanda"}
            </button>
          </fieldset>
          {tab && (
            <>
              <fieldset disabled={busy || !open} className="tab-section">
                <legend>Adicionar produtos</legend>
                <label>
                  Produto
                  <select
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setModifiers([]);
                    }}
                  >
                    <option value="">Selecione um produto</option>
                    {products.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name} · {money(p.price_cents)} / {p.unit}
                      </option>
                    ))}
                  </select>
                </label>
                {products
                  .find((p) => p.id === productId)
                  ?.modifier_groups?.map((group) => (
                    <fieldset key={group.id}>
                      <legend>
                        {group.name} · escolha de {group.min_choices} a{" "}
                        {group.max_choices}
                      </legend>
                      {group.options.map((option) => (
                        <label className="stock-check" key={option.id}>
                          <input
                            type="checkbox"
                            checked={modifiers.includes(option.id)}
                            disabled={
                              !modifiers.includes(option.id) &&
                              group.options.filter((o) =>
                                modifiers.includes(o.id),
                              ).length >= group.max_choices
                            }
                            onChange={(e) =>
                              setModifiers((current) =>
                                e.target.checked
                                  ? [...current, option.id]
                                  : current.filter((id) => id !== option.id),
                              )
                            }
                          />
                          {option.name} · + {money(option.price_cents)}
                        </label>
                      ))}
                    </fieldset>
                  ))}
                <label>
                  Quantidade
                  <input
                    type="number"
                    min="0.001"
                    step={
                      products.find((p) => p.id === productId)?.unit === "unit"
                        ? "1"
                        : "0.001"
                    }
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label>
                  Observações
                  <input
                    value={notes}
                    maxLength={1000}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={
                    !productId ||
                    (
                      products.find((p) => p.id === productId)
                        ?.modifier_groups ?? []
                    ).some((g) => {
                      const count = g.options.filter((o) =>
                        modifiers.includes(o.id),
                      ).length;
                      return count < g.min_choices || count > g.max_choices;
                    }) ||
                    modifiers.length > 50 ||
                    !Number.isFinite(Number(quantity)) ||
                    Number(quantity) <= 0 ||
                    (products.find((p) => p.id === productId)?.unit ===
                      "unit" &&
                      !Number.isInteger(Number(quantity)))
                  }
                  onClick={() => {
                    const p = products.find((p) => p.id === productId)!;
                    setDraft((current) => [
                      ...current,
                      {
                        product_id: p.id,
                        catalog_version: p.version,
                        quantity,
                        notes: notes.trim() || null,
                        name: p.name,
                        price: p.price_cents,
                        modifier_option_ids: [...modifiers],
                        modifier_names: (p.modifier_groups ?? [])
                          .flatMap((g) =>
                            g.options
                              .filter((o) => modifiers.includes(o.id))
                              .map(
                                (o) => `${o.name} (+ ${money(o.price_cents)})`,
                              ),
                          )
                          .join(", "),
                      },
                    ]);
                    setNotes("");
                    setQuantity("1");
                    setModifiers([]);
                  }}
                >
                  Adicionar ao pedido
                </button>
                {draft.map((item, i) => (
                  <p key={i}>
                    {item.quantity} × {item.name}{" "}
                    {item.modifier_names && (
                      <span> · {item.modifier_names}</span>
                    )}
                    <button
                      className="text-button"
                      onClick={() =>
                        setDraft((current) =>
                          current.filter((_, index) => index !== i),
                        )
                      }
                    >
                      Remover
                    </button>
                  </p>
                ))}
                <button
                  className="button"
                  disabled={!draft.length || dirty}
                  onClick={() =>
                    void run(
                      `${base}/tabs/${tab.id}/orders`,
                      {
                        expected_version: tab.version,
                        items: draft.map(
                          ({
                            product_id,
                            catalog_version,
                            quantity,
                            notes,
                            modifier_option_ids,
                          }) => ({
                            product_id,
                            catalog_version,
                            quantity,
                            notes,
                            modifier_option_ids,
                          }),
                        ),
                      },
                      "POST",
                      "Pedido enviado.",
                    )
                  }
                >
                  Enviar pedido
                </button>
              </fieldset>
              {dirty && (
                <p>
                  Salve as alterações de pessoas antes de enviar pedidos ou
                  fechar a mesa.
                </p>
              )}
              <div className="tab-section">
                <h3>Consumo registrado</h3>
                {tab.guests.map((g, i) => (
                  <p key={i}>
                    {g.quantity} × {g.label} · {g.name_snapshot} ·{" "}
                    {g.complimentary
                      ? "Cortesia"
                      : money(g.quantity * (g.unit_price_cents ?? 0))}
                  </p>
                ))}
                {tab.orders
                  .flatMap((o) => o.items)
                  .map((i) => (
                    <p key={i.id}>
                      {i.quantity} × {i.name_snapshot} ·{" "}
                      {i.status === "cancelled"
                        ? "Cancelado"
                        : money(
                            Number(i.quantity) *
                              (i.unit_price_cents +
                                (i.modifiers ?? []).reduce(
                                  (sum, m) =>
                                    sum +
                                    Number(m.quantity) * m.unit_price_cents,
                                  0,
                                )),
                          )}
                      {(i.modifiers ?? []).map((m, index) => (
                        <span key={index}>
                          {" "}
                          · {m.name_snapshot} (+ {money(m.unit_price_cents)})
                        </span>
                      ))}
                    </p>
                  ))}
                <strong>Total: {money(tab.amounts.total_cents)}</strong>
                <p>Saldo: {money(tab.amounts.balance_cents)}</p>
              </div>
              {open && (
                <div className="tab-section">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={service}
                      disabled={busy}
                      onChange={(e) => setService(e.target.checked)}
                    />{" "}
                    Incluir taxa de serviço
                  </label>
                  <p>
                    Fechar bloqueia novos consumos e envia a conta para
                    pagamento no caixa. A mesa continua ocupada até o
                    encerramento financeiro.
                  </p>
                  <button
                    className="button"
                    disabled={busy || dirty || !!draft.length}
                    onClick={() =>
                      void run(
                        `${base}/tabs/${tab.id}/start-closing`,
                        {
                          expected_version: tab.version,
                          service_accepted: service,
                        },
                        "POST",
                        "Mesa fechada para consumo. Conta encaminhada ao caixa.",
                      )
                    }
                  >
                    Fechar mesa e enviar ao caixa
                  </button>
                </div>
              )}
              {tab.status === "closing" &&
                (role === "owner" ||
                  settings?.tab_reopen_roles.includes(role)) && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        `${base}/tabs/${tab.id}/resume`,
                        { expected_version: tab.version },
                        "POST",
                        "Mesa reaberta para consumo.",
                      )
                    }
                  >
                    Reabrir mesa
                  </button>
                )}
              {tab.status === "closing" && (
                <p>
                  A reabertura está disponível aos perfis autorizados pelo
                  administrador, antes de registrar pagamentos.
                </p>
              )}
            </>
          )}
          {role === "owner" && settings && (
            <fieldset className="tab-section" disabled={busy}>
              <legend>Quem pode reabrir mesas</legend>
              <p>
                O administrador sempre pode reabrir. Marque os outros perfis
                autorizados nesta unidade.
              </p>
              {[
                { id: "cashier", label: "Caixa" },
                { id: "waiter", label: "Garçom" },
                { id: "manager", label: "Gerente" },
              ].map((r) => (
                <label className="checkbox-label" key={r.id}>
                  <input
                    type="checkbox"
                    checked={settings.tab_reopen_roles.includes(r.id)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        tab_reopen_roles: e.target.checked
                          ? [...settings.tab_reopen_roles, r.id]
                          : settings.tab_reopen_roles.filter(
                              (id) => id !== r.id,
                            ),
                      })
                    }
                  />
                  {r.label}
                </label>
              ))}
              <button
                className="secondary-button"
                onClick={() =>
                  void run(
                    `${base}/settings`,
                    {
                      expected_version: settings.version,
                      tab_reopen_roles: settings.tab_reopen_roles,
                    },
                    "PATCH",
                    "Permissões de reabertura atualizadas.",
                  )
                }
              >
                Salvar permissões
              </button>
            </fieldset>
          )}
        </>
      )}
    </Dialog>
  );
}
