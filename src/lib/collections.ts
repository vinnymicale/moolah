/** Return a new Set with `value` toggled - added if absent, removed if present. */
export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Return a new array with the item at `from` moved to index `to`. */
export function moveInArray<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to) return next;
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Merge a stored order with the ids that currently exist: keep known ids in
 * their stored positions, drop ones that are gone, append ones that are new.
 * The result always contains every available id exactly once.
 */
export function reconcileOrder<T>(order: readonly T[], available: readonly T[]): T[] {
  const remaining = new Set(available);
  const kept: T[] = [];
  for (const item of order) {
    if (remaining.delete(item)) kept.push(item);
  }
  return [...kept, ...available.filter((item) => remaining.has(item))];
}
