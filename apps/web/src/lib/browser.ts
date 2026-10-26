"use client";
import { createSupabaseClient } from "./supabase";
let client: ReturnType<typeof createSupabaseClient> | undefined;
export function supabase() {
  return (client ??= createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  ));
}
