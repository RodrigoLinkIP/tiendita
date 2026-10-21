import { createClient } from "@supabase/supabase-js";

export function supabaseAnonKey() {
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  return String(key).includes("service_role") ? "" : key;
}

export function hasSupabaseEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = supabaseAnonKey();
  return Boolean(url && key);
}

let client;

export function getSupabase() {
  if (!hasSupabaseEnv()) return null;
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL, supabaseAnonKey(), {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export function useLocalMode() {
  if (import.meta.env.VITE_LOCAL_MODE === "true") return true;
  return !hasSupabaseEnv();
}
