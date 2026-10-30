"use client";
import { useEffect, useRef, useState } from "react";
import { api, message } from "../lib/api";
import { parsePrice, priceInput } from "../lib/stock";
type Row = {
  id: string;
  version: number;
  name?: string;
  active: boolean;
  min_choices?: number;
  max_choices?: number;
  price_cents?: number;
  group_id?: string;
  product_id?: string;
};
async function rows(path: string) {
  const items: Row[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Row[]; next_cursor: string | null } = await api(
      `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { fresh: true },
    );
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}
export function ProductModifiers({
  tenantId,
  productId,
}: {
  tenantId: string;
  productId: string;
}) {
  const base = `/tenants/${tenantId}`;
  const [data, setData] = useState<{
    groups: Row[];
    options: Row[];
    links: Row[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{
    resource: string;
    row?: Row;
    group?: string;
  }>();
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    void Promise.all([
      rows(`${base}/modifier-groups`),
      rows(`${base}/modifier-options`),
      rows(`${base}/product-modifier-groups`),
    ])
      .then(([groups, options, links]) => {
        if (active) setData({ groups, options, links });
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [base, revision]);
  async function write(resource: string, body: object, id?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    const path = `${base}/${resource}${id ? `/${id}` : ""}`;
    const signature = JSON.stringify([path, body]);
    if (!keys.current.has(signature))
      keys.current.set(signature, crypto.randomUUID());
    try {
      await api(path, {
        method: id ? "PATCH" : "POST",
        body,
        key: keys.current.get(signature),
      });
      keys.current.delete(signature);
      setEditor(undefined);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const f = new FormData(event.currentTarget);
    try {
      const body = {
        name: String(f.get("name")).trim(),
        active: f.get("active") === "on",
        ...(editor.row ? { expected_version: editor.row.version } : {}),
        ...(editor.resource === "modifier-groups"
          ? {
              min_choices: Number(f.get("min")),
              max_choices: Number(f.get("max")),
            }
          : {
              price_cents: parsePrice(String(f.get("price"))),
              ...(!editor.row ? { group_id: editor.group } : {}),
            }),
      };
      if (
        editor.resource === "modifier-groups" &&
        Number(f.get("max")) < Number(f.get("min"))
      )
        throw new Error("O máximo deve ser maior ou igual ao mínimo.");
      await write(editor.resource, body, editor.row?.id);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="tab-section">
      <h3>Adicionais do produto</h3>
      <p className="helper">
        Grupos podem ser usados em vários produtos. Alterar um grupo ou opção
        afeta todos os produtos vinculados.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setEditor(undefined);
              setRevision((n) => n + 1);
            }}
          >
            Recarregar
          </button>
        </p>
      )}
      {!data ? (
        <p role="status">Carregando adicionais…</p>
      ) : (
        data.groups.map((g) => {
          const link = data.links.find(
            (l) => l.product_id === productId && l.group_id === g.id,
          );
          return (
            <div key={g.id} className="tab-section">
              <strong>
                {g.name} · {g.min_choices} a {g.max_choices} escolhas
                {!g.active ? " · Inativo" : ""}
              </strong>
              <label className="stock-check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={!!link?.active}
                  onChange={(e) =>
                    void write(
                      "product-modifier-groups",
                      link
                        ? {
                            expected_version: link.version,
                            active: e.target.checked,
                          }
                        : {
                            product_id: productId,
                            group_id: g.id,
                            active: true,
                          },
                      link?.id,
                    )
                  }
                />
                Usar neste produto
              </label>
              <button
                type="button"
                disabled={busy}
                className="text-button"
                onClick={() =>
                  setEditor({ resource: "modifier-groups", row: g })
                }
              >
                Editar grupo
              </button>
              <ul>
                {data.options
                  .filter((o) => o.group_id === g.id)
                  .map((o) => (
                    <li key={o.id}>
                      {o.name} · R$ {priceInput(o.price_cents ?? 0)}
                      {!o.active ? " · Inativo" : ""}{" "}
                      <button
                        type="button"
                        disabled={busy}
                        className="text-button"
                        onClick={() =>
                          setEditor({ resource: "modifier-options", row: o })
                        }
                      >
                        Editar opção
                      </button>
                    </li>
                  ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                className="secondary-button"
                onClick={() =>
                  setEditor({ resource: "modifier-options", group: g.id })
                }
              >
                Adicionar opção
              </button>
            </div>
          );
        })
      )}
      <button
        type="button"
        disabled={busy}
        className="secondary-button"
        onClick={() => setEditor({ resource: "modifier-groups" })}
      >
        Criar grupo de adicionais
      </button>
      {editor && (
        <form
          key={`${editor.resource}/${editor.row?.id ?? editor.group ?? "new"}/${revision}`}
          onSubmit={save}
        >
          <fieldset disabled={busy}>
            <legend>
              {editor.row ? "Editar" : "Criar"}{" "}
              {editor.resource === "modifier-groups" ? "grupo" : "opção"}
            </legend>
            <label>
              Nome
              <input
                name="name"
                required
                maxLength={160}
                defaultValue={editor.row?.name ?? ""}
              />
            </label>
            {editor.resource === "modifier-groups" ? (
              <div className="form-row">
                <label>
                  Mínimo de escolhas
                  <input
                    name="min"
                    type="number"
                    required
                    min={0}
                    max={50}
                    defaultValue={editor.row?.min_choices ?? 0}
                  />
                </label>
                <label>
                  Máximo de escolhas
                  <input
                    name="max"
                    type="number"
                    required
                    min={0}
                    max={50}
                    defaultValue={editor.row?.max_choices ?? 1}
                  />
                </label>
              </div>
            ) : (
              <label>
                Preço adicional (R$)
                <input
                  name="price"
                  inputMode="decimal"
                  required
                  defaultValue={priceInput(editor.row?.price_cents ?? 0)}
                />
              </label>
            )}
            <label className="stock-check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editor.row?.active ?? true}
              />
              Ativo
            </label>
            <button className="button" type="submit">
              {busy ? "Salvando…" : "Salvar adicional"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setEditor(undefined)}
            >
              Cancelar edição
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
