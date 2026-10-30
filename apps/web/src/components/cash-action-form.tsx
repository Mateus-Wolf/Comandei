"use client";
import { useRef, useState } from "react";
import { api, message, RequestError } from "../lib/api";
import { money, parseAmount, type CashOverview } from "../lib/cash";
import { Dialog } from "./dialog";
export type CashAction =
  "register" | "open" | "supply" | "withdrawal" | "close";
const titles = {
  register: "Cadastrar terminal de caixa",
  open: "Abrir turno de caixa",
  supply: "Registrar suprimento",
  withdrawal: "Registrar sangria",
  close: "Fechar turno de caixa",
};
export function CashActionForm({
  action,
  tenantId,
  data,
  onClose,
  onSaved,
}: {
  action: CashAction;
  tenantId: string;
  data: CashOverview;
  onClose: () => void;
  onSaved: (sessionId?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(action === "open" ? "0,00" : "");
  const mutation = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  let difference: number | undefined;
  try {
    difference = parseAmount(amount) - data.totals.expected_cash_cents;
  } catch {
    /* Wait for a valid count. */
  }
  const needsReason =
    action === "close" &&
    difference !== undefined &&
    Math.abs(difference) > data.difference_tolerance_cents;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || stale) return;
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      let endpoint: string;
      let body: Record<string, unknown>;
      if (action === "register") {
        endpoint = "cash-registers";
        body = {
          name: String(form.get("name")).trim(),
          code: String(form.get("code")).trim(),
        };
      } else if (action === "open") {
        endpoint = "cash-sessions";
        body = {
          register_id: String(form.get("register_id")),
          initial_balance_cents: parseAmount(amount),
        };
      } else {
        const session = data.session;
        if (!session || session.status !== "open")
          throw new Error("Selecione um turno aberto para continuar.");
        endpoint = `cash-sessions/${session.id}/${action === "close" ? "close" : "movements"}`;
        const value = parseAmount(amount);
        const reason = String(form.get("reason") ?? "").trim();
        if (action === "close") {
          if (form.get("confirmed") !== "on")
            throw new Error("Confirme a contagem antes de encerrar o turno.");
          body = {
            expected_version: session.version,
            declared_cents: value,
            ...(reason ? { reason } : {}),
          };
        } else {
          if (value <= 0) throw new Error("Informe um valor maior que zero.");
          if (
            action === "withdrawal" &&
            value > data.totals.expected_cash_cents
          )
            throw new Error(
              "A sangria não pode exceder o dinheiro esperado no caixa.",
            );
          body = {
            expected_version: session.version,
            type: action,
            amount_cents: value,
            reason,
          };
        }
      }
      const signature = endpoint + JSON.stringify(body);
      if (mutation.current?.signature !== signature)
        mutation.current = { signature, key: crypto.randomUUID() };
      if (action === "supply" || action === "withdrawal")
        body.operation_key = mutation.current!.key;
      setBusy(true);
      const result = await api<{ id?: string }>(
        `/tenants/${tenantId}/${endpoint}`,
        { method: "POST", body, key: mutation.current!.key },
      );
      await onSaved(action === "open" ? result.id : undefined);
      onClose();
    } catch (error) {
      if (error instanceof RequestError && error.code === "VERSION_CONFLICT") {
        setStale(true);
        setError(
          "O turno recebeu novas operações. Feche este formulário, atualize a tela e confira os valores novamente.",
        );
      } else setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={titles[action]} onClose={onClose} busy={busy}>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy || stale}>
          {action === "register" ? (
            <>
              <label>
                Nome do terminal
                <input
                  name="name"
                  required
                  maxLength={160}
                  placeholder="Ex.: Caixa principal"
                />
              </label>
              <label>
                Código
                <input
                  name="code"
                  required
                  maxLength={40}
                  placeholder="Ex.: CX-01"
                />
              </label>
            </>
          ) : (
            <>
              {action === "open" ? (
                <>
                  <p className="helper">
                    Informe o dinheiro disponível para troco no início do turno.
                  </p>
                  <label>
                    Terminal
                    <select name="register_id" required defaultValue="">
                      <option value="" disabled>
                        Selecione um terminal livre
                      </option>
                      {data.registers
                        .filter((item) => item.active && !item.occupied)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.code}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className="helper">
                  {data.session?.register_name} · Dinheiro esperado:{" "}
                  <strong>{money(data.totals.expected_cash_cents)}</strong>
                </p>
              )}
              <label>
                {action === "open"
                  ? "Saldo inicial (R$)"
                  : action === "close"
                    ? "Dinheiro contado (R$)"
                    : "Valor (R$)"}
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  maxLength={15}
                  placeholder="0,00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              {action !== "open" && (
                <label>
                  {action === "close"
                    ? "Justificativa da divergência"
                    : "Motivo"}
                  {!needsReason && action === "close" && (
                    <span className="optional"> (opcional)</span>
                  )}
                  <textarea
                    name="reason"
                    required={action !== "close" || needsReason}
                    minLength={3}
                    maxLength={1000}
                    rows={3}
                    placeholder={
                      action === "close"
                        ? "Explique a diferença na contagem, se houver"
                        : "Informe o motivo da movimentação"
                    }
                  />
                </label>
              )}
              {action === "close" && (
                <>
                  <p className="cash-count" role="status">
                    Diferença na contagem:{" "}
                    <strong>
                      {difference === undefined
                        ? "Informe o valor contado"
                        : money(difference)}
                    </strong>
                  </p>
                  <p className="field-hint">
                    Confira o dinheiro físico. Pix e cartões não compõem o saldo
                    da gaveta.
                  </p>
                  <label className="stock-check">
                    <input type="checkbox" name="confirmed" required />
                    <span>
                      Conferi a contagem e desejo encerrar este turno.
                    </span>
                  </label>
                </>
              )}
            </>
          )}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="button compact-button"
            disabled={busy || stale}
          >
            {busy
              ? "Salvando…"
              : action === "close"
                ? "Confirmar fechamento"
                : action === "open"
                  ? "Abrir turno"
                  : "Salvar"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
