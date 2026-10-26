import { supabase } from "./browser";
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
  } = {},
): Promise<T> {
  const { data } = await supabase().auth.getSession();
  if (!data.session)
    throw new RequestError("Sua sessão terminou. Entre novamente.", 401);
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/v1${path}`,
    {
      method: options.method ?? "GET",
      signal: options.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
  );
  const result = await response.json();
  if (!response.ok) {
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
  return result;
}
export type Restaurant = {
  id: string;
  name: string;
  status: string;
  role: string;
  address: string | null;
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
  active_tab: unknown | null;
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
