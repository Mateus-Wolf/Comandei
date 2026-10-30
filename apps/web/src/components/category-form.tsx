"use client";
import { useRef, useState } from "react";
import { api, message } from "../lib/api";
import type { StockCategory } from "../lib/stock";
import { Dialog } from "./dialog";
export function CategoryForm({
  tenantId,
  category,
  onClose,
  onSaved,
}: {
  tenantId: string;
  category?: StockCategory;
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
    const body = {
      name: String(form.get("name")).trim(),
      active: category ? form.get("active") === "on" : true,
      ...(category ? { expected_version: category.version } : {}),
    };
    const signature = JSON.stringify(body);
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await api(
        `/tenants/${tenantId}/categories${category ? "/" + category.id : ""}`,
        {
          method: category ? "PATCH" : "POST",
          body,
          key: mutation.current!.key,
        },
      );
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
      title={category ? "Editar categoria" : "Criar categoria"}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label>
            Nome da categoria
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={category?.name}
              placeholder="Ex.: Bebidas"
            />
          </label>
          {category && (
            <>
              <label className="stock-check">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={category.active}
                />
                <span>Categoria ativa</span>
              </label>
              <p className="field-hint">
                Categorias inativas deixam de aparecer nas opções de novos
                produtos.
              </p>
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
            disabled={busy}
          >
            {busy ? "Salvando…" : "Salvar categoria"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
