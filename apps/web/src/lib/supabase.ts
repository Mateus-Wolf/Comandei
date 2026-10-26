import { createClient } from "@supabase/supabase-js";

// Auth/Realtime somente: tabelas operacionais são acessadas pela API FastAPI.
export function createSupabaseClient(url: string, publishableKey: string) {
  if (!url || !publishableKey) {
    throw new Error("Configure a URL e a chave publicável do Supabase.");
  }
  return createClient(url, publishableKey);
}
