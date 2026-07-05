"use client";

import { useState, useTransition } from "react";
import { Check, Send } from "lucide-react";
import { saveAlertConfigAction, sendTestAlertAction } from "@/actions/alerts";
import type { BackupSchedule } from "@/lib/backup/schedule";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function AlertsForm({
  config,
}: {
  config: {
    enabled: boolean;
    kind: string;
    url: string;
    schedule: BackupSchedule;
    billsDays: number;
    budgetsEnabled: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  };
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [kind, setKind] = useState(config.kind);
  const [url, setUrl] = useState(config.url);
  const [frequency, setFrequency] = useState(config.schedule.frequency);
  const [hour, setHour] = useState(config.schedule.hour);
  const [weekday, setWeekday] = useState(config.schedule.weekday ?? 0);
  const [billsDays, setBillsDays] = useState(config.billsDays);
  const [budgetsEnabled, setBudgetsEnabled] = useState(config.budgetsEnabled);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Live "Send test" result, separate from the persisted last-run status below.
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, startTest] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const schedule: BackupSchedule =
        frequency === "weekly" ? { frequency, hour, weekday } : { frequency, hour };
      const res = await saveAlertConfigAction({
        enabled,
        kind,
        url,
        schedule,
        billsDays,
        budgetsEnabled,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const sendTest = () =>
    startTest(async () => {
      setError(null);
      setTestResult(null);
      const res = await sendTestAlertAction();
      if (!res.ok) {
        setError(res.error ?? "Test alert failed.");
        return;
      }
      setTestResult("Test alert sent. Check your notifications.");
    });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Send a scheduled digest of what&apos;s due and over budget
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Delivery method</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="ntfy">ntfy topic</option>
            <option value="webhook">Webhook (JSON)</option>
          </select>
        </div>

        <div>
          <label className="label">{kind === "ntfy" ? "Topic URL" : "Webhook URL"}</label>
          <input
            className="input"
            type="url"
            value={url}
            placeholder={kind === "ntfy" ? "https://ntfy.sh/your-topic" : "https://example.com/hook"}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Frequency</label>
          <select
            className="input"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>

        {frequency === "weekly" && (
          <div>
            <label className="label">Day of week</label>
            <select className="input" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">Time of day</label>
          <select className="input" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Look ahead (days)</label>
          <input
            type="number"
            min={1}
            max={30}
            className="input"
            value={billsDays}
            onChange={(e) => setBillsDays(Number(e.target.value))}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand"
          checked={budgetsEnabled}
          onChange={(e) => setBudgetsEnabled(e.target.checked)}
        />
        Include categories that are over budget
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={pending} className="btn-primary">
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save alerts"}
        </button>
        <button onClick={sendTest} disabled={testing} className="btn-ghost">
          <Send size={14} /> {testing ? "Sending…" : "Send test alert"}
        </button>
      </div>

      {error && <p className="text-sm text-expense">{error}</p>}
      {testResult && (
        <p className="rounded-lg border border-income/40 bg-income/5 px-3 py-2 text-sm text-income">
          {testResult}
        </p>
      )}

      {config.lastRunAt && !testResult && (
        <p className={`text-xs ${config.lastStatus === "error" ? "text-expense" : "text-muted"}`}>
          Last run {new Date(config.lastRunAt).toLocaleString()} —{" "}
          {config.lastStatus === "success"
            ? "sent"
            : config.lastStatus === "skipped"
            ? "nothing to report, skipped"
            : config.lastStatus === "error"
            ? `failed: ${config.lastError ?? "unknown error"}`
            : config.lastStatus}
          .
        </p>
      )}

      <p className="text-xs text-muted">
        Alerts run on the server while it&apos;s running, so this fits a self-hosted / always-on
        setup. The digest covers upcoming bills, credit-card due dates and over-budget categories;
        days with nothing to report are skipped. For phone notifications the easiest path is a free{" "}
        <a className="text-brand hover:underline" href="https://ntfy.sh" target="_blank" rel="noreferrer">
          ntfy.sh
        </a>{" "}
        topic — pick a hard-to-guess topic name, since anyone who knows it can read it.
      </p>
    </div>
  );
}
