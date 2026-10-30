"use client";
import { useEffect, useRef, useState } from "react";
import { api, message, RequestError } from "../lib/api";
import { useWorkspace } from "./workspace-shell";
import { RestaurantFilter } from "./restaurant-filter";

type Settings = {
  version: number;
  timezone: string;
  business_day_cutoff: string;
  service_rate_bps: number;
  cashier_discount_limit_bps: number;
  manager_discount_limit_bps: number;
  cash_difference_tolerance_cents: number;
};
const fields = [
  ["service_rate_bps", "Taxa de serviço (%)"],
  ["cashier_discount_limit_bps", "Desconto máximo do caixa (%)"],
  ["manager_discount_limit_bps", "Desconto máximo do gerente (%)"],
  ["cash_difference_tolerance_cents", "Tolerância de diferença no caixa (R$)"],
] as const;
export default function SettingsScreen() {
  const { restaurants, loading } = useWorkspace();
  const allowed = restaurants.filter((r) => r.role === "owner");
  const [selected, setSelected] = useState("");
  const restaurant = allowed.find((r) => r.id === selected) ?? allowed[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h1>Configurações</h1>
          <p>Defina as regras de atendimento e fechamento do restaurante.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Carregando restaurantes…</p>
      ) : !restaurant ? (
        <section className="empty-state">
          <h2>Acesso restrito ao administrador</h2>
          <p>
            É necessário ser administrador de uma unidade para alterar suas
            configurações.
          </p>
        </section>
      ) : (
        <>
          <RestaurantFilter
            restaurants={allowed}
            value={restaurant.id}
            onChange={setSelected}
          />
          <SettingsForm key={restaurant.id} tenantId={restaurant.id} />
        </>
      )}
    </>
  );
}
function SettingsForm({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Settings>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [conflict, setConflict] = useState(false);
  const active = useRef(true);
  const mutation = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const path = `/tenants/${tenantId}/settings`;
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setData(undefined);
    setError("");
    setSuccess(false);
    setConflict(false);
    void api<Settings>(path, { signal: controller.signal, fresh: true })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [path, retry]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy || conflict) return;
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | number> = {
      expected_version: data.version,
      timezone: String(form.get("timezone")).trim(),
      business_day_cutoff: String(form.get("business_day_cutoff")),
    };
    for (const [name] of fields) {
      const value = Number(form.get(name));
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (name !== "cash_difference_tolerance_cents" && value > 100)
      ) {
        setError("Confira os valores informados.");
        return;
      }
      body[name] = Math.round(value * 100);
    }
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: String(body.timezone) });
    } catch {
      setError("Informe um fuso válido, como America/Sao_Paulo.");
      return;
    }
    const signature = JSON.stringify(body);
    if (mutation.current?.signature !== signature)
      mutation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      const result = await api<Settings>(path, {
        method: "PATCH",
        body,
        key: mutation.current.key,
      });
      if (active.current) {
        setData(result);
        setSuccess(true);
        mutation.current = undefined;
      }
    } catch (e) {
      if (active.current) {
        setError(message(e));
        if (e instanceof RequestError && e.status === 409) setConflict(true);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="settings-panel">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(!data || conflict) && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => setRetry((n) => n + 1)}
        >
          Recarregar configurações
        </button>
      )}
      {!data && !error && <p role="status">Carregando configurações…</p>}
      {conflict && (
        <p role="alert">
          As configurações mudaram. Recarregue e confira os valores antes de
          salvar novamente.
        </p>
      )}
      {data && (
        <form key={data.version} onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy || conflict} className="settings-fields">
            <legend>Regras da unidade</legend>
            {fields.map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  type="number"
                  min="0"
                  max={
                    name === "cash_difference_tolerance_cents" ? undefined : 100
                  }
                  step="0.01"
                  required
                  defaultValue={(data[name] / 100).toFixed(2)}
                />
              </label>
            ))}
            <label>
              Fuso horário
              <input
                name="timezone"
                required
                defaultValue={data.timezone}
                list="restaurant-timezones"
              />
              <datalist id="restaurant-timezones">
                {[
                  "America/Sao_Paulo",
                  "America/Manaus",
                  "America/Rio_Branco",
                  "America/Noronha",
                ].map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </label>
            <label>
              Horário de corte do dia operacional
              <input
                name="business_day_cutoff"
                type="time"
                step="1"
                required
                defaultValue={data.business_day_cutoff}
              />
            </label>
          </fieldset>
          <p className="field-hint">
            Antes do horário de corte, os lançamentos pertencem ao dia
            operacional anterior. A taxa de serviço continua opcional no
            fechamento. Descontos acima do limite exigem aprovação; diferenças
            acima da tolerância exigem justificativa.
          </p>
          {success && <p role="status">Configurações salvas.</p>}
          <button className="button compact-button" disabled={busy || conflict}>
            {busy ? "Salvando…" : "Salvar configurações"}
          </button>
        </form>
      )}
    </section>
  );
}
