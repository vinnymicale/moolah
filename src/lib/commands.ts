import type { LucideIcon } from "lucide-react";

// A command-palette entry: either jump to a page or run an action. The palette
// itself stays presentational - the parent supplies the `run` closures so this
// list can drive navigation, modals, imports, etc. without the palette knowing
// about any of them.
export interface Command {
  id: string;
  label: string;
  // Extra words to match against that aren't shown (e.g. "go to", synonyms).
  keywords?: string;
  hint?: string;
  icon?: LucideIcon;
  run: () => void;
}

/**
 * Filter and rank commands for a query. An empty query returns everything in
 * its original order (so the palette can show all commands up front). A
 * non-empty query keeps commands whose label/keywords contain every
 * whitespace-separated term, ranking a label prefix match above a label
 * substring match above a keywords-only match. Ties keep input order.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const terms = q.split(/\s+/);

  const scored: { cmd: Command; score: number; i: number }[] = [];
  commands.forEach((cmd, i) => {
    const label = cmd.label.toLowerCase();
    const haystack = `${label} ${cmd.keywords?.toLowerCase() ?? ""}`;
    if (!terms.every((t) => haystack.includes(t))) return;
    // Lower score sorts first.
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
    scored.push({ cmd, score, i });
  });

  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.map((s) => s.cmd);
}
