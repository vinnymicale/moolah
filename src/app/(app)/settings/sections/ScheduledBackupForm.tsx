"use client";

import { useState, useTransition } from "react";
import { Check, HardDrive, Play } from "lucide-react";
import {
  saveBackupConfigAction,
  runBackupNowAction,
  runLocalBackupNowAction,
} from "@/actions/backup";
import type { BackupSchedule } from "@/lib/backup/schedule";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Destinations the user can pick. Dropbox is shown disabled until its connect
// flow lands.
const DESTINATIONS = [
  { value: "local", label: "This server (local folder)", ready: true },
  { value: "gdrive", label: "Google Drive", ready: true },
  { value: "dropbox", label: "Dropbox (coming soon)", ready: false },
];

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function ScheduledBackupForm({
  config,
}: {
  config: {
    enabled: boolean;
    destination: string;
    schedule: BackupSchedule;
    keepCount: number;
    // Whether Google Drive credentials are already stored, so the form can show
    // "connected" instead of asking for them again. The secrets never reach the
    // browser.
    gdriveConnected: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastBackupName: string | null;
  };
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [destination, setDestination] = useState(config.destination);
  const [frequency, setFrequency] = useState(config.schedule.frequency);
  const [hour, setHour] = useState(config.schedule.hour);
  const [weekday, setWeekday] = useState(config.schedule.weekday ?? 0);
  const [keepCount, setKeepCount] = useState(config.keepCount);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Google Drive credential fields. Left blank when already connected; filling
  // them in re-saves the connection.
  const [gdClientId, setGdClientId] = useState("");
  const [gdClientSecret, setGdClientSecret] = useState("");
  const [gdRefreshToken, setGdRefreshToken] = useState("");
  const [gdFolderId, setGdFolderId] = useState("");

  // Live "Run now" result, separate from the persisted last-run status below.
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const [runningLocal, startLocalRun] = useTransition();

  const destReady = DESTINATIONS.find((d) => d.value === destination)?.ready ?? false;

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const schedule: BackupSchedule =
        frequency === "weekly" ? { frequency, hour, weekday } : { frequency, hour };
      const credentials =
        destination === "gdrive"
          ? {
              clientId: gdClientId.trim(),
              clientSecret: gdClientSecret.trim(),
              refreshToken: gdRefreshToken.trim(),
              folderId: gdFolderId.trim(),
            }
          : undefined;
      const res = await saveBackupConfigAction({
        enabled,
        destination,
        schedule,
        keepCount,
        credentials,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      // Don't keep secrets sitting in the form after they're stored.
      setGdClientSecret("");
      setGdRefreshToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const runNow = () =>
    startRun(async () => {
      setError(null);
      setRunResult(null);
      const res = await runBackupNowAction();
      if (!res.ok) {
        setError(res.error ?? "Backup failed.");
        return;
      }
      setRunResult(
        res.pruned > 0
          ? `Saved ${res.name} (pruned ${res.pruned} old ${res.pruned === 1 ? "copy" : "copies"}).`
          : `Saved ${res.name}.`,
      );
    });

  // Local backup regardless of the destination dropdown, so a quick on-server
  // copy doesn't require flipping the schedule away from Google Drive.
  const runLocalNow = () =>
    startLocalRun(async () => {
      setError(null);
      setRunResult(null);
      const res = await runLocalBackupNowAction();
      if (!res.ok) {
        setError(res.error ?? "Backup failed.");
        return;
      }
      setRunResult(
        res.pruned > 0
          ? `Saved ${res.name} to the local folder (pruned ${res.pruned} old ${res.pruned === 1 ? "copy" : "copies"}).`
          : `Saved ${res.name} to the local folder.`,
      );
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
        Run automatic backups on a schedule
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Where to store backups</label>
          <select
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {DESTINATIONS.map((d) => (
              <option key={d.value} value={d.value} disabled={!d.ready}>
                {d.label}
              </option>
            ))}
          </select>
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
          <label className="label">Copies to keep</label>
          <input
            type="number"
            min={1}
            max={365}
            className="input"
            value={keepCount}
            onChange={(e) => setKeepCount(Number(e.target.value))}
          />
        </div>
      </div>

      {destination === "gdrive" && (
        <div className="space-y-3 rounded-lg border border-line bg-surface2/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Google Drive connection</h3>
            {config.gdriveConnected && (
              <span className="inline-flex items-center gap-1 text-xs text-income">
                <Check size={14} /> Connected
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            Create an OAuth client (Desktop app) in the{" "}
            <a
              className="text-brand hover:underline"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud console
            </a>
            , grant the <code className="rounded bg-surface2 px-1 py-0.5 text-text">drive.file</code>{" "}
            scope once, and paste the values below. They&apos;re encrypted in your database and never
            sent back to the browser.{" "}
            {config.gdriveConnected && "Leave blank to keep the current connection."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Client ID</label>
              <input
                className="input"
                value={gdClientId}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdClientId(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Client secret</label>
              <input
                type="password"
                className="input"
                value={gdClientSecret}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdClientSecret(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Refresh token</label>
              <input
                type="password"
                className="input"
                value={gdRefreshToken}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdRefreshToken(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Folder ID</label>
              <input
                className="input"
                value={gdFolderId}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdFolderId(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            The folder ID is the last path segment of the Drive folder&apos;s URL. Backups are written
            into that folder and retention only prunes files there.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={pending} className="btn-primary">
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save schedule"}
        </button>
        <button onClick={runNow} disabled={running || runningLocal || !destReady} className="btn-ghost">
          <Play size={14} /> {running ? "Backing up…" : "Run backup now"}
        </button>
        {destination !== "local" && (
          <button onClick={runLocalNow} disabled={running || runningLocal} className="btn-ghost">
            <HardDrive size={14} /> {runningLocal ? "Backing up…" : "Back up to local folder"}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-expense">{error}</p>}
      {runResult && (
        <p className="rounded-lg border border-income/40 bg-income/5 px-3 py-2 text-sm text-income">
          {runResult}
        </p>
      )}

      {config.lastRunAt && !runResult && (
        <p
          className={`text-xs ${config.lastStatus === "error" ? "text-expense" : "text-muted"}`}
        >
          Last run {new Date(config.lastRunAt).toLocaleString()} —{" "}
          {config.lastStatus === "success"
            ? `success${config.lastBackupName ? ` (${config.lastBackupName})` : ""}`
            : config.lastStatus === "error"
            ? `failed: ${config.lastError ?? "unknown error"}`
            : config.lastStatus}
          .
        </p>
      )}

      <p className="text-xs text-muted">
        Backups run on the server while it&apos;s running, so this fits a self-hosted / always-on
        setup. The local folder defaults to{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">./backups</code>; set{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">BACKUP_LOCAL_DIR</code> to point
        it at a mounted volume. Each backup is a full JSON dump including your Plaid tokens — keep the
        folder private.
      </p>
    </div>
  );
}
