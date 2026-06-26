"use client";

import { useSyncExternalStore } from "react";

// True once the component has hydrated on the client, false during SSR and the
// first paint. Uses useSyncExternalStore so it stays out of an effect (the
// server snapshot is false, the client snapshot is true) - handy for holding a
// skeleton in place until client-only widgets like recharts can mount.

const noop = () => () => {};

export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
