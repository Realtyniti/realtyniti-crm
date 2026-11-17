import "server-only";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import type { Store } from "./types";
import { isReadOnly } from "../read-only";
import { readOnly } from "./read-only-store";
import { scopedStore } from "./scoped";
import { maskedStore } from "./masked";
import { can, isViewOnly } from "../auth/roles";
import type { Member } from "../auth/store";

const globalForStore = globalThis as unknown as { __realtynitiStore?: Store };

/** Supabase when configured, otherwise an in-memory demo store (data resets on restart). */
export function getStore(): Store {
  if (!globalForStore.__realtynitiStore) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const store = url && key ? new SupabaseStore(url, key) : new MemoryStore();
    globalForStore.__realtynitiStore = isReadOnly() ? readOnly(store) : store;
  }
  return globalForStore.__realtynitiStore;
}

/** The lead store as this member may see it: everything for the owner and managers, only their own leads for an agent. */
export function getStoreFor(member: Pick<Member, "id" | "role">): Store {
  // A reviewer sees every screen, read-only, with buyers' contact details masked.
  if (isViewOnly(member.role)) return readOnly(maskedStore(getStore()));
  return can(member.role, "leads.all") ? getStore() : scopedStore(getStore(), member.id);
}

export function isDemoStore(): boolean {
  return !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type { Store } from "./types";
