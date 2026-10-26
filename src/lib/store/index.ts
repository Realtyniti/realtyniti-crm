import "server-only";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";

const globalForStore = globalThis as unknown as { __realtynitiStore?: Store };

/** Supabase when configured, otherwise an in-memory demo store (data resets on restart). */
export function getStore(): Store {
  if (!globalForStore.__realtynitiStore) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalForStore.__realtynitiStore = url && key ? new SupabaseStore(url, key) : new MemoryStore();
  }
  return globalForStore.__realtynitiStore;
}

export function isDemoStore(): boolean {
  return !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type { Store } from "./types";
