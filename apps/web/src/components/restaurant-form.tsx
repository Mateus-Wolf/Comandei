"use client";
import { useEffect, useRef, useState } from "react";
import {
  api,
  message,
  type Restaurant,
  type RestaurantAddress,
} from "../lib/api";
import { supabase } from "../lib/browser";
import { formatCep, formatCnpj } from "../lib/registration";
import { Dialog } from "./dialog";
export function RestaurantForm({
  restaurant,
  onClose,
  onSaved,
  onPersisted,
}: {
  restaurant?: Restaurant;
  onClose: () => void;
  onSaved: (id: string) => void;
  onPersisted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<File>();
  const [preview, setPreview] = useState("");
  const [cnpj, setCnpj] = useState(formatCnpj(restaurant?.cnpj ?? ""));
  const [address, setAddress] = useState<RestaurantAddress>(
    restaurant?.address_details ?? {
      postal_code: "",
      state: "",
      city: "",
      neighborhood: "",
      street: restaurant?.address ?? "",
      number: "",
      complement: "",
    },
  );
  const [cepStatus, setCepStatus] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const previousCep = useRef(restaurant?.address_details?.postal_code ?? "");
  useEffect(() => {
    if (previousCep.current === address.postal_code) return;
    previousCep.current = address.postal_code;
    setCepStatus("");
    setLookingUp(false);
    if (address.postal_code.length !== 8) return;
    setLookingUp(true);
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLookingUp(true);
      setCepStatus("Buscando endereço…");
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(
          `https://viacep.com.br/ws/${address.postal_code}/json/`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result.erro) {
          setCepStatus(
            "CEP não encontrado. Confira o CEP ou preencha o endereço manualmente.",
          );
          return;
        }
        setAddress((previous) => ({
          ...previous,
          state: result.uf ?? "",
          city: result.localidade ?? "",
          neighborhood: result.bairro ?? "",
          street: result.logradouro ?? "",
        }));
        setCepStatus(
          "Endereço encontrado. Confira os dados e informe o número e o complemento, se houver.",
        );
      } catch {
        if (!active) return;
        if (!controller.signal.aborted)
          setCepStatus(
            "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
          );
        else
          setCepStatus(
            "A consulta demorou demais. Preencha o endereço manualmente.",
          );
      } finally {
        clearTimeout(timeout);
        if (active) setLookingUp(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [address.postal_code]);
  const savedId = useRef(restaurant?.id);
  const version = useRef(restaurant?.version ?? 1);
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  function key(path: string, body: unknown) {
    const signature = path + JSON.stringify(body);
    if (!keys.current.has(signature))
      keys.current.set(signature, crypto.randomUUID());
    return keys.current.get(signature)!;
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || lookingUp) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    let baseSaved = false;
    let refreshed = false;
    const fields = {
      name: String(form.get("name")).trim(),
      address: `${address.street}, ${address.number} - ${address.neighborhood}, ${address.city}/${address.state}`,
      address_details: address,
      cnpj: String(form.get("cnpj")).trim(),
      opens_at: String(form.get("opens_at")),
      closes_at: String(form.get("closes_at")),
      service_type: String(form.get("service_type")),
    };
    try {
      if (savedId.current) {
        const body = { ...fields, expected_version: version.current };
        const path = `/tenants/${savedId.current}/settings`;
        const result = await api<{ version: number }>(path, {
          method: "PATCH",
          body,
          key: key(path, body),
        });
        version.current = result.version;
      } else {
        const result = await api<{ id: string }>("/restaurants", {
          method: "POST",
          body: fields,
          key: key("/restaurants", fields),
        });
        savedId.current = result.id;
      }
      baseSaved = true;
      if (photo) {
        const extension = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        }[photo.type];
        if (!extension) throw new Error("Escolha uma imagem JPG, PNG ou WebP.");
        const path = `${savedId.current}/${crypto.randomUUID()}.${extension}`;
        const storage = supabase().storage.from("restaurant-photos");
        const uploaded = await storage.upload(path, photo, {
          contentType: photo.type,
          upsert: false,
        });
        if (uploaded.error)
          throw new Error("Não foi possível enviar a foto. Tente novamente.");
        const body = { expected_version: version.current, photo_path: path };
        const endpoint = `/tenants/${savedId.current}/settings`;
        // Keep the uploaded object on an ambiguous network failure: the DB may already reference it.
        const result = await api<{ version: number }>(endpoint, {
          method: "PATCH",
          body,
          key: key(endpoint, body),
        });
        version.current = result.version;
        if (restaurant?.photo_path && restaurant.photo_path !== path)
          void storage.remove([restaurant.photo_path]);
      }
      refreshed = true;
      await onPersisted();
      onSaved(savedId.current!);
    } catch (error) {
      if (baseSaved && !refreshed) await onPersisted();
      setError(
        (baseSaved && photo
          ? "Os dados foram salvos, mas a foto não foi concluída. Você pode tentar salvar novamente. "
          : "") + message(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={restaurant ? "Editar restaurante" : "Criar restaurante"}
      onClose={onClose}
      busy={busy}
    >
      <p className="helper">
        Cadastre os dados da unidade para organizar suas mesas.
      </p>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label>
            Nome do restaurante
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={restaurant?.name}
              placeholder="Ex.: Casa do Sabor"
            />
          </label>
          <label>
            Foto do restaurante <span className="optional">(opcional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              ref={(input) => {
                if (!input) return;
                // Stop the native event before React's dialog cancel handler sees it.
                const cancel = (event: Event) => event.stopPropagation();
                input.addEventListener("cancel", cancel);
                return () => input.removeEventListener("cancel", cancel);
              }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (
                  file &&
                  (!["image/jpeg", "image/png", "image/webp"].includes(
                    file.type,
                  ) ||
                    file.size > 5242880)
                ) {
                  event.target.value = "";
                  setPhoto(undefined);
                  setError("Use uma imagem JPG, PNG ou WebP de até 5 MB.");
                  return;
                }
                setError("");
                setPhoto(file);
              }}
            />
          </label>
          {preview && (
            <img
              className="photo-preview"
              src={preview}
              alt="Prévia da foto do restaurante"
            />
          )}
          <p className="field-hint">
            JPG, PNG ou WebP, até 5 MB. A foto será visível à equipe vinculada.
          </p>
          <label>
            CEP
            <input
              name="postal_code"
              required
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={9}
              pattern="[0-9]{5}-[0-9]{3}"
              placeholder="00000-000"
              value={formatCep(address.postal_code)}
              onChange={(event) =>
                setAddress((previous) => ({
                  ...previous,
                  postal_code: event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 8),
                }))
              }
              aria-describedby="cep-status"
            />
          </label>
          <p id="cep-status" className="field-hint" role="status">
            {cepStatus ||
              "Digite o CEP para preencher o endereço automaticamente."}
          </p>
          <fieldset disabled={lookingUp} aria-busy={lookingUp}>
            <div className="form-row">
              <label>
                Estado (UF)
                <select
                  name="state"
                  required
                  autoComplete="address-level1"
                  value={address.state}
                  onChange={(event) =>
                    setAddress((previous) => ({
                      ...previous,
                      state: event.target.value,
                    }))
                  }
                >
                  <option value="">Selecione</option>
                  {[
                    "AC",
                    "AL",
                    "AP",
                    "AM",
                    "BA",
                    "CE",
                    "DF",
                    "ES",
                    "GO",
                    "MA",
                    "MT",
                    "MS",
                    "MG",
                    "PA",
                    "PB",
                    "PR",
                    "PE",
                    "PI",
                    "RJ",
                    "RN",
                    "RS",
                    "RO",
                    "RR",
                    "SC",
                    "SP",
                    "SE",
                    "TO",
                  ].map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cidade
                <input
                  name="city"
                  required
                  maxLength={160}
                  autoComplete="address-level2"
                  value={address.city}
                  onChange={(event) =>
                    setAddress((previous) => ({
                      ...previous,
                      city: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label>
              Bairro
              <input
                name="neighborhood"
                required
                maxLength={160}
                autoComplete="address-level3"
                value={address.neighborhood}
                onChange={(event) =>
                  setAddress((previous) => ({
                    ...previous,
                    neighborhood: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Endereço
              <input
                name="street"
                required
                maxLength={200}
                autoComplete="address-line1"
                placeholder="Rua, avenida…"
                value={address.street}
                onChange={(event) =>
                  setAddress((previous) => ({
                    ...previous,
                    street: event.target.value,
                  }))
                }
              />
            </label>
          </fieldset>
          <div className="form-row">
            <label>
              Número
              <input
                name="number"
                required
                maxLength={20}
                placeholder="Ex.: 123 ou S/N"
                value={address.number}
                onChange={(event) =>
                  setAddress((previous) => ({
                    ...previous,
                    number: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Complemento <span className="optional">(opcional)</span>
              <input
                name="complement"
                maxLength={160}
                autoComplete="address-line2"
                placeholder="Sala, bloco…"
                value={address.complement}
                onChange={(event) =>
                  setAddress((previous) => ({
                    ...previous,
                    complement: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <label>
            CNPJ
            <input
              name="cnpj"
              required
              minLength={18}
              maxLength={18}
              pattern="[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}/[A-Z0-9]{4}-[0-9]{2}"
              value={cnpj}
              onChange={(event) => setCnpj(formatCnpj(event.target.value))}
              placeholder="00.000.000/0000-00"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </label>
          <div className="form-row">
            <label>
              Abre às
              <input
                name="opens_at"
                type="time"
                required
                defaultValue={restaurant?.opens_at?.slice(0, 5)}
              />
            </label>
            <label>
              Fecha às
              <input
                name="closes_at"
                type="time"
                required
                defaultValue={restaurant?.closes_at?.slice(0, 5)}
              />
            </label>
          </div>
          <p className="field-hint">
            Use o horário local do restaurante. O fechamento pode ocorrer após a
            meia-noite.
          </p>
          <label>
            Tipo de atendimento
            <select
              name="service_type"
              defaultValue={restaurant?.service_type ?? "alacarte"}
            >
              <option value="alacarte">À la carte</option>
              <option value="rodizio">Rodízio</option>
              <option value="both">Rodízio e à la carte</option>
            </select>
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
            disabled={busy || lookingUp}
          >
            {busy
              ? "Salvando…"
              : lookingUp
                ? "Consultando CEP…"
                : "Salvar restaurante"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
