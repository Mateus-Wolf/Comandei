"use client";
import { useRef, useState } from "react";
import { api, message, type DiningTable } from "../lib/api";
import { Dialog } from "./dialog";
export function TableForm({
  tenantId,
  table,
  onClose,
  onSaved,
}: {
  tenantId: string;
  table?: DiningTable;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mutation = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code"));
    const capacity = Number(form.get("capacity"));
    const body = {
      code,
      name: `Mesa ${code}`,
      capacity,
      ...(table ? { expected_version: table.version } : {}),
    };
    const signature = JSON.stringify(body);
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await api(`/tenants/${tenantId}/tables${table ? "/" + table.id : ""}`, {
        method: table ? "PATCH" : "POST",
        body,
        key: mutation.current!.key,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={table ? "Editar mesa" : "Adicionar mesa"}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label>
            Número da mesa
            <input
              name="code"
              type="number"
              min={1}
              max={999999}
              step={1}
              required
              defaultValue={table?.code}
              placeholder="Ex.: 12"
            />
          </label>
          <label>
            Quantidade de assentos
            <input
              name="capacity"
              type="number"
              min={1}
              max={1000}
              step={1}
              required
              defaultValue={table?.capacity ?? 4}
            />
          </label>
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
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="button compact-button"
            disabled={busy}
          >
            {busy ? "Salvando…" : "Salvar mesa"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
