"use client";

import { useTransition } from "react";
import Link from "next/link";
import { CalendarCheck, Repeat } from "lucide-react";
import { Modal } from "@/components/Modal";
import { formatUSD } from "@/lib/money";
import { materializeOccurrenceAction } from "@/actions/transactions";
import type { CalendarEvent } from "@/lib/calendar";
import { formatDayLabel } from "./calendar-utils";

export function OccurrenceModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const [pending, start] = useTransition();
  const markPaid = () =>
    start(async () => {
      if (event.recurringRuleId) {
        await materializeOccurrenceAction(event.recurringRuleId, event.date, true);
      }
      onClose();
    });

  return (
    <Modal open onClose={onClose} title="Expected transaction" widthClass="max-w-sm">
      <div className="space-y-4">
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{event.description}</span>
            <span className={`tabular-nums font-semibold ${event.type === "INCOME" ? "text-income" : "text-expense"}`}>
              {event.type === "INCOME" ? "+" : "-"}
              {formatUSD(event.amount)}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <Repeat size={12} /> Recurring · {formatDayLabel(event.date)}
          </p>
        </div>
        <p className="text-sm text-muted">
          This is projected from a recurring rule. Mark it as {event.type === "INCOME" ? "received" : "paid"} once it actually happens.
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={markPaid} disabled={pending} className="btn-primary">
            <CalendarCheck size={16} /> Mark as {event.type === "INCOME" ? "received" : "paid"}
          </button>
          <Link href="/recurring" className="btn-ghost">
            Edit the recurring series
          </Link>
        </div>
      </div>
    </Modal>
  );
}
