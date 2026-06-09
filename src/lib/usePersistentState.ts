"use client";

import { useCallback, useSyncExternalStore } from "react";

// localStorage-backed React state that is SSR-safe - it renders `initial` on the
// server and the first client paint, then reconciles to the stored value - and
// stays in sync across components and browser tabs. Built on useSyncExternalStore
// so there's no hydrate-in-effect (and no cascading re-render it would cause).
//
// Pass a stable `initial` (a module constant for arrays/objects) so the server
// snapshot is referentially stable.

const subscribers = new Map<string, Set<() => void>>();
// Cache the parsed value per key so repeated reads return a stable reference
// (required by useSyncExternalStore) until the raw string actually changes.
const snapshots = new Map<string, { raw: string | null; value: unknown }>();

function notify(key: string) {
  subscribers.get(key)?.forEach((fn) => fn());
}

const noopSubscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Lets a component
 * defer rendering storage-dependent UI to the client without a hydration
 * mismatch or a hydrate-in-effect.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    let set = subscribers.get(key);
    if (!set) subscribers.set(key, (set = new Set()));
    set.add(onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        snapshots.delete(key);
        onChange();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      set.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  const getSnapshot = useCallback((): T => {
    const raw = readRaw(key);
    const cached = snapshots.get(key);
    if (cached && cached.raw === raw) return cached.value as T;
    let value = initial;
    if (raw !== null) {
      try {
        value = JSON.parse(raw) as T;
      } catch {
        value = initial;
      }
    }
    snapshots.set(key, { raw, value });
    return value;
  }, [key, initial]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial);

  const setValue = useCallback((next: T) => {
    const raw = JSON.stringify(next);
    try {
      window.localStorage.setItem(key, raw);
    } catch {
      // unavailable or over quota
    }
    snapshots.set(key, { raw, value: next });
    notify(key);
  }, [key]);

  return [value, setValue];
}
