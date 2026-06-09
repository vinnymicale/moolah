import { Modal } from "./Modal";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Search all transactions" },
  { keys: ["n"], label: "Add a transaction" },
  { keys: ["i"], label: "Import a CSV" },
  { keys: ["/"], label: "Focus search (on pages with it)" },
  { keys: ["?"], label: "Show this help" },
];

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" widthClass="max-w-sm">
      <ul className="space-y-2">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted">{s.label}</span>
            <span className="flex gap-1">
              {s.keys.map((k) => (
                <kbd key={k} className="rounded border border-line bg-surface2 px-2 py-0.5 font-mono text-xs">{k}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">Shortcuts are ignored while you&apos;re typing in a field.</p>
    </Modal>
  );
}
