import { ReadOnlyError } from "../read-only";
import type { Store } from "./types";

const WRITE = /^(insert|update|upsert|add)/;

/** Every write method throws; reads pass straight through. */
export function readOnly(store: Store): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && WRITE.test(prop) && typeof value === "function") {
        return () => Promise.reject(new ReadOnlyError());
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
