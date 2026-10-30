"use client";
import { useRef, useState } from "react";
import { api, message, RequestError } from "../lib/api";
import {
  parsePrice,
  priceInput,
  unitLabels,
  type StockCategory,
  type StockProduct,
  type ProductUnit,
} from "../lib/stock";
import { Dialog } from "./dialog";
import { ProductModifiers } from "./product-modifiers";
export function ProductForm({
  tenantId,
  product,
  categories,
  onClose,
  onSaved,
}: {
  tenantId: string;
  product?: StockProduct;
  categories: StockCategory[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const mutation = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict) return;
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      const body = {
        name: String(form.get("name")).trim(),
        sku: String(form.get("sku")).trim() || null,
        category_id: String(form.get("category_id")),
        unit: String(form.get("unit")),
        price_cents: parsePrice(String(form.get("price"))),
        available: form.get("available") === "on",
        active: product ? form.get("active") === "on" : true,
        ...(product ? { expected_version: product.version } : {}),
      };
      const category = categories.find((item) => item.id === body.category_id);
      if (!category?.active)
        throw new Error("Selecione uma categoria ativa para salvar o produto.");
      const signature = JSON.stringify(body);
      if (mutation.current?.signature !== signature)
        mutation.current = { signature, key: crypto.randomUUID() };
      setBusy(true);
      await api(
        `/tenants/${tenantId}/products${product ? "/" + product.id : ""}`,
        {
          method: product ? "PATCH" : "POST",
          body,
          key: mutation.current!.key,
        },
      );
      await onSaved();
      onClose();
    } catch (error) {
      if (error instanceof RequestError && error.code === "VERSION_CONFLICT") {
        setConflict(true);
        setError(
          "Este produto foi alterado por outra pessoa. Feche o formulário e atualize a lista antes de editar novamente.",
        );
      } else setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={product ? "Editar produto" : "Cadastrar produto"}
      onClose={onClose}
      busy={busy}
    >
      <p className="helper">
        Cadastre o produto e defina como ele aparece na operação do restaurante.
      </p>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy || conflict}>
          <label>
            Nome do produto
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={product?.name}
              placeholder="Ex.: Suco de laranja"
            />
          </label>
          <div className="form-row">
            <label>
              Categoria
              <select
                name="category_id"
                required
                defaultValue={
                  product?.category_id ??
                  categories.find((item) => item.active)?.id ??
                  ""
                }
              >
                <option value="" disabled>
                  Selecione
                </option>
                {categories
                  .filter(
                    (item) => item.active || item.id === product?.category_id,
                  )
                  .map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.active}
                    >
                      {item.name}
                      {!item.active ? " (inativa)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Unidade
              <select name="unit" defaultValue={product?.unit ?? "unit"}>
                {(Object.keys(unitLabels) as ProductUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {unitLabels[unit]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Preço (R$)
              <input
                name="price"
                inputMode="decimal"
                required
                maxLength={15}
                placeholder="0,00"
                defaultValue={priceInput(product?.price_cents ?? 0)}
              />
            </label>
            <label>
              Código / SKU <span className="optional">(opcional)</span>
              <input
                name="sku"
                maxLength={80}
                defaultValue={product?.sku ?? ""}
                placeholder="Ex.: BEB-001"
              />
            </label>
          </div>
          <label className="stock-check">
            <input
              type="checkbox"
              name="available"
              defaultChecked={product?.available ?? true}
            />
            <span>Disponível para pedidos</span>
          </label>
          {product && (
            <label className="stock-check">
              <input
                type="checkbox"
                name="active"
                defaultChecked={product.active}
              />
              <span>Produto ativo no cadastro</span>
            </label>
          )}
          <p className="field-hint">
            Desmarque a disponibilidade para suspender novos pedidos deste
            produto.
          </p>
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
            disabled={busy || conflict}
          >
            {busy ? "Salvando…" : "Salvar produto"}
          </button>
        </div>
      </form>
      {product ? (
        <ProductModifiers tenantId={tenantId} productId={product.id} />
      ) : (
        <p className="helper">
          Após salvar, abra Editar produto para cadastrar os adicionais.
        </p>
      )}
    </Dialog>
  );
}
