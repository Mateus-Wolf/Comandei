import { supabase } from "./browser";
import { createRecordCache } from "./record-cache";
const reads = createRecordCache();
let cacheOwner: string | undefined;
export function clearApiCache() {
  cacheOwner = undefined;
  reads.clear();
}
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
    fresh?: boolean;
  } = {},
): Promise<T> {
  const { data } = await supabase().auth.getSession();
  if (!data.session) {
    clearApiCache();
    throw new RequestError("Sua sessão terminou. Entre novamente.", 401);
  }
  const token = data.session.access_token;
  const owner = `${data.session.user.id}:${data.session.user.last_sign_in_at ?? ""}`;
  if (cacheOwner !== owner) {
    reads.clear();
    cacheOwner = owner;
  }
  const method = (options.method ?? "GET").toUpperCase();
  const load = async (): Promise<T> => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/v1${path}`,
      {
        method,
        signal: options.signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.key ? { "Idempotency-Key": options.key } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
    );
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) clearApiCache();
      if (response.status === 409 && cacheOwner === owner)
        reads.mutate(owner, path, method, null);
      const fields = result.error?.details?.fields as
        { location: string[]; message: string }[] | undefined;
      const cnpj = fields?.find((field) => field.location.includes("cnpj"));
      throw new RequestError(
        cnpj
          ? "Confira o CNPJ e seus dígitos verificadores."
          : (result.error?.message ?? "Não foi possível concluir a operação."),
        response.status,
        result.error?.code,
      );
    }
    if (method !== "GET" && cacheOwner === owner)
      reads.mutate(owner, path, method, result);
    return result;
  };
  return method === "GET"
    ? reads.read(owner, path, load, options.signal, options.fresh)
    : load();
}
export type RestaurantAddress = {
  postal_code: string;
  state: string;
  city: string;
  neighborhood: string;
  street: string;
  number: string;
  complement: string;
};
export type Restaurant = {
  id: string;
  name: string;
  status: string;
  role: string;
  address: string | null;
  address_details: RestaurantAddress | null;
  cnpj: string | null;
  opens_at: string | null;
  closes_at: string | null;
  service_type: "rodizio" | "alacarte" | "both";
  photo_path: string | null;
  version: number;
};
export type DiningTable = {
  id: string;
  code: string;
  name: string;
  capacity: number | null;
  active: boolean;
  version: number;
  active_tab: {
    id: string;
    number: number;
    status: string;
    version: number;
  } | null;
};
export const serviceLabels = {
  rodizio: "Rodízio",
  alacarte: "À la carte",
  both: "Rodízio e à la carte",
};
export function message(error: unknown) {
  if (error instanceof TypeError)
    return "Não foi possível conectar à API. Confira a conexão e tente novamente.";
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
