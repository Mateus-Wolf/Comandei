"use client";
import { useEffect, useRef, useState } from "react";
import { api, message, type Restaurant } from "../lib/api";
import { supabase } from "../lib/browser";
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
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    let baseSaved = false;
    const fields = {
      name: String(form.get("name")).trim(),
      address: String(form.get("address")).trim(),
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
      await onPersisted();
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
      await onPersisted();
      onSaved(savedId.current!);
    } catch (error) {
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
            Endereço completo
            <input
              name="address"
              required
              minLength={3}
              maxLength={500}
              defaultValue={restaurant?.address ?? ""}
              autoComplete="street-address"
              placeholder="Rua, número, bairro, cidade e estado"
            />
          </label>
          <label>
            CNPJ
            <input
              name="cnpj"
              required
              minLength={14}
              maxLength={24}
              defaultValue={restaurant?.cnpj ?? ""}
              placeholder="00.000.000/0000-00"
              autoCapitalize="characters"
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
            disabled={busy}
          >
            {busy ? "Salvando…" : "Salvar restaurante"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
