"use client";

import { Trash2 } from "lucide-react";
import { useConfirmAction } from "@/lib/useConfirmAction";

type Props = {
  onConfirm: () => void;
  label: string;
  title?: string;
  disabled?: boolean;
  size?: "sm" | "md";
};

// Icon-only delete button that needs two clicks. The first arms it and widens the
// button to spell out "Confirm"; the second deletes. Replaces window.confirm() so
// destructive actions look like the rest of the app.
export default function ConfirmDeleteButton({
  onConfirm,
  label,
  title = "Delete",
  disabled,
  size = "md",
}: Props) {
  const { armed, trigger } = useConfirmAction(onConfirm);
  const box = size === "sm" ? "h-7" : "h-8";
  const width = armed ? "px-2 text-xs" : size === "sm" ? "w-7 p-0!" : "w-8 p-0!";
  // Widest the button gets: icon + gap + "Confirm" at text-xs, plus px-2.
  const slot = size === "sm" ? "w-[84px]" : "w-[88px]";
  // btn-danger is the house class for destructive buttons (see RecurringManager).
  const tone = armed ? "btn-danger" : "btn-ghost text-muted hover:text-expense";

  return (
    // The slot reserves the armed width so arming never reflows the row. The reorder
    // arrows sit immediately left of this button; without the reserve they slide out
    // from under the cursor the moment the button widens to say "Confirm".
    <div className={`flex ${slot} shrink-0 justify-end`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          trigger();
        }}
        // Once armed, ignore the incoming disabled prop: it's a panel-wide pending
        // flag shared by unrelated actions, and if it flips true during the 3s
        // armed window it swallows the user's confirming click.
        disabled={armed ? false : disabled}
        className={`${tone} ${box} ${width} shrink-0 gap-1`}
        title={armed ? "Click to confirm" : title}
        aria-label={armed ? `Confirm delete ${label}` : `Delete ${label}`}
      >
        <Trash2 size={size === "sm" ? 13 : 14} />
        {armed && "Confirm"}
      </button>
      {/* Arming only mutates this button's own label, which screen readers announce
          inconsistently while it holds focus. Say it out loud instead. */}
      <span className="sr-only" role="status">
        {armed ? `Click again to delete ${label}` : ""}
      </span>
    </div>
  );
}
