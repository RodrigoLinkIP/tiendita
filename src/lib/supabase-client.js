import { createClient } from "@supabase/supabase-js";

export function hasSupabaseEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && key && !String(key).includes("service_role"));
}

let client;

export function getSupabase() {
  if (!hasSupabaseEnv()) return null;
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export function useLocalMode() {
  if (import.meta.env.VITE_LOCAL_MODE === "true") return true;
  return !hasSupabaseEnv();
}
