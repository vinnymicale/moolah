"use client";

import { useState, useTransition } from "react";
import { setMemberCapabilitiesAction } from "@/actions/household";
import { CAPABILITIES, roleDefaults, type Capability, type HouseholdRoleName } from "@/lib/capabilities";

/**
 * Three states per capability, because a member's effective permission is the
 * role's default plus grants minus denials - showing only a checkbox would
 * make "allowed because the role says so" and "allowed because an admin ticked
 * it" look identical, and there'd be no way to take the former away.
 */
type Setting = "default" | "grant" | "deny";

const LABELS: Record<Capability, string> = {
  VIEW_DASHBOARD: "View dashboard",
  VIEW_TRANSACTIONS: "View transactions",
  VIEW_ACCOUNTS: "View accounts",
  VIEW_BUDGETS: "View budgets",
  VIEW_GOALS: "View goals",
  VIEW_DEBT: "View debt",
  VIEW_RETIREMENT: "View retirement",
  VIEW_TRENDS: "View trends",
  VIEW_CALENDAR: "View calendar",
  VIEW_CATEGORIES: "View categories",
  VIEW_RULES: "View rules",
  EDIT_TRANSACTIONS: "Edit transactions",
  MANAGE_BUDGETS: "Create and edit budgets",
  MANAGE_CATEGORIES: "Manage categories",
  MANAGE_RULES: "Manage rules",
  MANAGE_GOALS: "Manage goals",
  MANAGE_RECURRING: "Manage recurring items",
  MANAGE_ACCOUNTS: "Add and edit accounts",
  RUN_SYNC: "Run bank sync",
  EXPORT_DATA: "Export data",
};

function initialSettings(granted: string[], denied: string[]): Record<string, Setting> {
  const out: Record<string, Setting> = {};
  for (const c of CAPABILITIES) {
    out[c] = denied.includes(c) ? "deny" : granted.includes(c) ? "grant" : "default";
  }
  return out;
}

export function PermissionEditor({
  memberId,
  role,
  granted,
  denied,
}: {
  memberId: string;
  role: HouseholdRoleName;
  granted: string[];
  denied: string[];
}) {
  const [settings, setSettings] = useState(() => initialSettings(granted, denied));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const defaults = roleDefaults(role);

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const grants = CAPABILITIES.filter((c) => settings[c] === "grant");
      const denials = CAPABILITIES.filter((c) => settings[c] === "deny");
      const res = await setMemberCapabilitiesAction(memberId, grants, denials);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Default follows the {role.toLowerCase()} role. Allow or block to override it for this person.
      </p>

      <ul className="divide-y divide-line rounded-lg border border-line">
        {CAPABILITIES.map((cap) => {
          const setting = settings[cap];
          const inherited = defaults.has(cap) ? "allowed" : "blocked";
          return (
            <li key={cap} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">
                {LABELS[cap]}
                {setting === "default" && (
                  <span className="ml-2 text-xs text-muted">({inherited} by role)</span>
                )}
              </span>
              <div className="flex shrink-0 gap-1">
                {(["default", "grant", "deny"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, [cap]: option }))}
                    className={`rounded px-2 py-1 text-xs ${
                      setting === option ? "bg-surface2 font-medium text-text" : "text-muted hover:text-text"
                    }`}
                  >
                    {option === "default" ? "Default" : option === "grant" ? "Allow" : "Block"}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save permissions"}
        </button>
        {saved && <span className="text-xs text-muted">Saved.</span>}
      </div>
      {error && <p className="text-sm text-expense">{error}</p>}
    </div>
  );
}
