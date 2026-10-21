import { createLocalStore, fictionalCatalog } from "./local-store.js";
import { createSupabaseStore } from "./supabase-store.js";
import { useLocalMode } from "./supabase-client.js";

let instance;

export function getStore() {
  if (!instance) {
    instance = useLocalMode() ? createLocalStore() : createSupabaseStore();
  }
  return instance;
}

export { fictionalCatalog };
