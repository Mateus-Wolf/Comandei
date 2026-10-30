"use client";
import { useLiveRefresh } from "../lib/use-live-refresh";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, message } from "../lib/api";
import {
  amountInput,
  methodLabels,
  money,
  parseAmount,
  type CashSession,
} from "../lib/cash";
import { Dialog } from "./dialog";
import { printReceipt, type Receipt } from "../lib/receipt";
type TabDetail = {
  id: string;
  number: number;
  status: string;
  version: number;
  service_accepted: boolean;
  guests: {
    label: string;
    quantity: number;
    name_snapshot: string;
    unit_price_cents: number;
    complimentary: boolean;
  }[];
  amounts: {
    subtotal_cents: number;
    discount_cents: number;
    service_cents: number;
    total_cents: number;
    received_cents: number;
    balance_cents: number;
  };
  orders: {
    items: {
      id: string;
      name_snapshot: string;
      quantity: string;
      unit_price_cents: number;
      status: string;
      modifiers: { name_snapshot: string; quantity: number }[];
    }[];
  }[];
  payments: {
    id: string;
    type: "receipt" | "refund";
    method: string;
    amount_cents: number;
  }[];
};
export function CashCheckout({
  tenantId,
  tabId,
  session,
  onClose,
  onSaved,
}: {
  tenantId: string;
  tabId: string;
  session: CashSession | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TabDetail>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [service, setService] = useState(true);
  const [amount, setAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("cash");
  const [confirmed, setConfirmed] = useState(false);
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [autoPrint, setAutoPrint] = useState(true);
  const [stale, setStale] = useState(false);
  const keys = useRef(new Map<string, string>());
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api<TabDetail>(
        `/tenants/${tenantId}/tabs/${tabId}`,
        { signal, fresh: true },
      );
      if (!signal?.aborted) {
        setTab(result);
        setStale(false);
      }
      return result;
    },
    [tenantId, tabId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setService(result.service_accepted);
          setAmount(amountInput(Math.max(0, result.amounts.balance_cents)));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);
  useLiveRefresh(
    `${tenantId}/${tabId}`,
    async (signal) => {
      const result = await api<TabDetail>(
        `/tenants/${tenantId}/tabs/${tabId}`,
        { signal, fresh: true },
      );
      if (
        !signal.aborted &&
        tab &&
        JSON.stringify(result) !== JSON.stringify(tab)
      ) {
        setStale(true);
        setConfirmed(false);
        setError(
          "Esta comanda mudou em outro dispositivo. Atualize os valores e confira o recebimento antes de continuar.",
        );
      }
    },
    !loading && !busy && !stale,
  );
  function commandKey(path: string, body: unknown) {
    const signature = path + JSON.stringify(body);
    if (!keys.current.has(signature))
      keys.current.set(signature, crypto.randomUUID());
    return keys.current.get(signature)!;
  }
  async function print() {
    const receipt = await api<Receipt>(
      `/tenants/${tenantId}/tabs/${tabId}/receipt`,
      { fresh: true },
    );
    printReceipt(receipt);
  }
  async function finish(current: TabDetail) {
    const path = `/tenants/${tenantId}/tabs/${current.id}/close`;
    const body = { expected_version: current.version };
    await api(path, { method: "POST", body, key: commandKey(path, body) });
    await load();
    setNotice("Comanda quitada e encerrada. A mesa foi liberada.");
    if (autoPrint) {
      try {
        await print();
      } catch {
        setError(
          "A comanda foi encerrada, mas o recibo não pôde ser impresso. Use Imprimir recibo para tentar novamente.",
        );
      }
    }
    await onSaved();
  }
  async function applyDiscount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tab || busy) return;
    setError("");
    setNotice("");
    try {
      const value = parseAmount(discount);
      if (
        value <= 0 ||
        value > tab.amounts.subtotal_cents - tab.amounts.discount_cents
      )
        throw new Error(
          "Informe um desconto maior que zero e dentro do consumo restante.",
        );
      if (discountReason.trim().length < 3)
        throw new Error(
          "Informe o motivo do desconto com pelo menos 3 caracteres.",
        );
      setBusy(true);
      const path = `/tenants/${tenantId}/tabs/${tab.id}/adjustments`;
      const body = {
        expected_version: tab.version,
        type: "discount",
        amount_cents: value,
        reason: discountReason.trim(),
      };
      const result = await api<{ status?: string }>(path, {
        method: "POST",
        body,
        key: commandKey(path, body),
      });
      const fresh = await load();
      setAmount(amountInput(Math.max(0, fresh.amounts.balance_cents)));
      setConfirmed(false);
      setDiscount("");
      setDiscountReason("");
      setNotice(
        result.status === "pending"
          ? "Desconto enviado para aprovação: o limite do seu perfil foi excedido. O desconto ainda não foi aplicado. Aguarde a aprovação e atualize a comanda antes de receber."
          : "Desconto aplicado. Confira o total atualizado antes de receber.",
      );
      await onSaved();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!tab || busy) return;
    setBusy(true);
    setError("");
    const path = `/tenants/${tenantId}/tabs/${tab.id}/start-closing`;
    const body = { expected_version: tab.version, service_accepted: service };
    try {
      await api(path, { method: "POST", body, key: commandKey(path, body) });
      const fresh = await load();
      setAmount(amountInput(Math.max(0, fresh.amounts.balance_cents)));
      await onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tab || busy) return;
    setError("");
    try {
      if (!session || session.status !== "open")
        throw new Error("Selecione um turno aberto para receber o pagamento.");
      if (!confirmed)
        throw new Error("Confirme o recebimento antes de registrar.");
      const value = parseAmount(amount);
      if (value <= 0 || value > tab.amounts.balance_cents)
        throw new Error(
          "O valor deve ser maior que zero e não exceder o saldo da comanda.",
        );
      const delivered =
        method === "cash" && tendered.trim()
          ? parseAmount(tendered)
          : undefined;
      if (delivered !== undefined && delivered < value)
        throw new Error("O dinheiro entregue deve cobrir o valor recebido.");
      const path = `/tenants/${tenantId}/tabs/${tab.id}/payments`;
      const body = {
        expected_version: tab.version,
        cash_session_id: session.id,
        method,
        amount_cents: value,
        confirmed: true,
        ...(delivered !== undefined ? { tendered_cents: delivered } : {}),
        ...(reference.trim() ? { external_reference: reference.trim() } : {}),
      };
      const key = commandKey(path, body);
      setBusy(true);
      const result = await api<{ balance_cents: number; change_cents: number }>(
        path,
        { method: "POST", body: { ...body, operation_key: key }, key },
      );
      setNotice(
        `Recebimento registrado. Troco: ${money(result.change_cents)}.`,
      );
      setAmount(
        result.balance_cents > 0 ? amountInput(result.balance_cents) : "",
      );
      setTendered("");
      setReference("");
      setConfirmed(false);
      const fresh = await load();
      if (result.balance_cents === 0) await finish(fresh);
      else await onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function closeTab() {
    if (!tab || busy) return;
    setBusy(true);
    setError("");
    try {
      await finish(tab);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      await load();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={tab ? `Comanda ${tab.number}` : "Conferir comanda"}
      onClose={onClose}
      busy={busy}
    >
      {loading ? (
        <p role="status">Carregando consumo…</p>
      ) : (
        tab && (
          <>
            <ul className="cash-items">
              {tab.guests.map((guest, index) => (
                <li key={`guest-${index}`}>
                  <span>
                    {guest.quantity} × {guest.name_snapshot} · {guest.label}
                  </span>
                  <small>
                    {guest.complimentary
                      ? "Cortesia · Sem cobrança"
                      : money(guest.quantity * guest.unit_price_cents)}
                  </small>
                </li>
              ))}
              {tab.orders
                .flatMap((order) => order.items)
                .filter((item) => item.status !== "cancelled")
                .map((item) => (
                  <li key={item.id}>
                    <span>
                      {Number(item.quantity).toLocaleString("pt-BR")} ×{" "}
                      {item.name_snapshot}
                    </span>
                    <small>
                      Preço base por unidade de medida:{" "}
                      {money(item.unit_price_cents)}
                    </small>
                    {item.modifiers.map((modifier, index) => (
                      <small key={index}>
                        {modifier.quantity} × {modifier.name_snapshot}
                      </small>
                    ))}
                  </li>
                ))}
            </ul>
            <dl className="cash-breakdown">
              <div>
                <dt>Consumo</dt>
                <dd>{money(tab.amounts.subtotal_cents)}</dd>
              </div>
              <div>
                <dt>Desconto</dt>
                <dd>{money(tab.amounts.discount_cents)}</dd>
              </div>
              <div>
                <dt>Serviço</dt>
                <dd>{money(tab.amounts.service_cents)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{money(tab.amounts.total_cents)}</dd>
              </div>
              <div>
                <dt>Recebido</dt>
                <dd>{money(tab.amounts.received_cents)}</dd>
              </div>
              <div className="cash-balance">
                <dt>Saldo a receber</dt>
                <dd>{money(tab.amounts.balance_cents)}</dd>
              </div>
            </dl>
            {!!tab.payments.length && (
              <section aria-label="Recebimentos registrados">
                <h3>Recebimentos registrados</h3>
                <ul className="cash-items">
                  {tab.payments.map((entry) => (
                    <li key={entry.id}>
                      {entry.type === "refund" ? "Estorno" : "Recebimento"} ·{" "}
                      {methodLabels[entry.method] ?? entry.method} ·{" "}
                      {money(entry.amount_cents)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {["open", "closing"].includes(tab.status) &&
              !tab.payments.length && (
                <form onSubmit={applyDiscount}>
                  <fieldset disabled={busy || stale} className="tab-section">
                    <legend>Aplicar desconto</legend>
                    <label>
                      Desconto adicional (R$)
                      <input
                        required
                        inputMode="decimal"
                        maxLength={15}
                        value={discount}
                        onChange={(event) => setDiscount(event.target.value)}
                      />
                    </label>
                    <label>
                      Motivo do desconto
                      <input
                        required
                        minLength={3}
                        maxLength={500}
                        value={discountReason}
                        onChange={(event) =>
                          setDiscountReason(event.target.value)
                        }
                      />
                    </label>
                    <p className="field-hint">
                      O desconto é aplicado antes do primeiro recebimento.
                      Valores acima do limite do perfil exigem aprovação.
                    </p>
                    <button
                      type="submit"
                      className="secondary-button"
                      disabled={busy || stale}
                    >
                      Aplicar desconto
                    </button>
                  </fieldset>
                </form>
              )}
            {tab.status !== "closed" && (
              <label className="stock-check">
                <input
                  type="checkbox"
                  checked={autoPrint}
                  disabled={busy || stale}
                  onChange={(event) => setAutoPrint(event.target.checked)}
                />
                <span>Imprimir recibo ao quitar e encerrar a comanda</span>
              </label>
            )}
            {tab.status === "open" && (
              <>
                <label className="stock-check">
                  <input
                    type="checkbox"
                    checked={service}
                    onChange={(event) => setService(event.target.checked)}
                    disabled={busy || stale}
                  />
                  <span>Incluir serviço no fechamento</span>
                </label>
                <p className="field-hint">
                  O total será recalculado ao iniciar o fechamento. A comanda
                  ficará bloqueada para novos pedidos.
                </p>
                <button
                  type="button"
                  className="button"
                  disabled={busy || stale}
                  onClick={() => void prepare()}
                >
                  Conferir valores e iniciar fechamento
                </button>
              </>
            )}
            {tab.status === "closing" && tab.amounts.balance_cents > 0 && (
              <form onSubmit={pay} aria-busy={busy}>
                <fieldset
                  disabled={busy || stale || session?.status !== "open"}
                >
                  <p className="helper">
                    Registre somente valores já recebidos. São permitidos
                    pagamentos parciais.
                  </p>
                  <label>
                    Meio de pagamento
                    <select
                      value={method}
                      onChange={(event) => {
                        setMethod(event.target.value);
                        setConfirmed(false);
                      }}
                    >
                      {Object.entries(methodLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-row">
                    <label>
                      Valor recebido (R$)
                      <input
                        required
                        inputMode="decimal"
                        maxLength={15}
                        value={amount}
                        onChange={(event) => {
                          setAmount(event.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    {method === "cash" && (
                      <label>
                        Dinheiro entregue (R$)
                        <input
                          inputMode="decimal"
                          maxLength={15}
                          placeholder="Opcional, para calcular troco"
                          value={tendered}
                          onChange={(event) => {
                            setTendered(event.target.value);
                            setConfirmed(false);
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <label>
                    Referência <span className="optional">(opcional)</span>
                    <input
                      name="reference"
                      value={reference}
                      onChange={(event) => {
                        setReference(event.target.value);
                        setConfirmed(false);
                      }}
                      maxLength={160}
                      placeholder="Identificação do recebimento"
                    />
                  </label>
                  <label className="stock-check">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>Confirmo que este valor foi recebido.</span>
                  </label>
                  <button
                    type="submit"
                    className="button"
                    disabled={busy || stale || !confirmed}
                  >
                    Registrar recebimento
                  </button>
                </fieldset>
                {session?.status !== "open" && (
                  <p className="helper">
                    Abra ou selecione um turno aberto para receber.
                  </p>
                )}
              </form>
            )}
            {tab.status === "closing" && tab.amounts.balance_cents === 0 && (
              <button
                type="button"
                className="button"
                disabled={busy || stale}
                onClick={() => void closeTab()}
              >
                Encerrar comanda quitada
              </button>
            )}
            {tab.status === "closed" && (
              <>
                <p className="helper">Esta comanda está encerrada.</p>
                <button
                  type="button"
                  className="button"
                  disabled={busy || stale}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await print();
                    } catch (err) {
                      setError(message(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Imprimir recibo
                </button>
              </>
            )}
          </>
        )
      )}
      {notice && (
        <p role="status" className="cash-success">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || stale}
          onClick={onClose}
        >
          Fechar
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          Atualizar comanda
        </button>
      </div>
    </Dialog>
  );
}
