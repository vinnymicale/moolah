"use client";

import { useState, useTransition } from "react";
import { setMemberCapabilitiesAction } from "@/actions/household";
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_LABELS,
  roleDefaults,
  type Capability,
  type HouseholdRoleName,
} from "@/lib/capabilities";

/**
 * Three states per capability, because a member's effective permission is the
 * role's default plus grants minus denials - showing only a checkbox would
 * make "allowed because the role says so" and "allowed because an admin ticked
 * it" look identical, and there'd be no way to take the former away.
 */
type Setting = "default" | "grant" | "deny";

const OPTIONS = ["default", "grant", "deny"] as const;

function optionLabel(option: Setting): string {
  return option === "default" ? "Default" : option === "grant" ? "Allow" : "Block";
}

function initialSettings(granted: string[], denied: string[]): Record<string, Setting> {
  const out: Record<string, Setting> = {};
  for (const c of CAPABILITIES) {
    out[c] = denied.includes(c) ? "deny" : granted.includes(c) ? "grant" : "default";
  }
  return out;
}

function SettingButtons({
  value,
  onPick,
  subtle = false,
}: {
  value: Setting | null;
  onPick: (option: Setting) => void;
  subtle?: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onPick(option)}
          className={`rounded px-2 py-1 text-xs ${
            value === option && !subtle
              ? "bg-surface2 font-medium text-text"
              : "text-muted hover:text-text"
          }`}
        >
          {optionLabel(option)}
        </button>
      ))}
    </div>
  );
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

  const setOne = (cap: Capability, option: Setting) =>
    setSettings((s) => ({ ...s, [cap]: option }));

  const setGroup = (capabilities: readonly Capability[], option: Setting) =>
    setSettings((s) => {
      const next = { ...s };
      for (const cap of capabilities) next[cap] = option;
      return next;
    });

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
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Default follows the {role.toLowerCase()} role. Allow or block to override it for this person.
      </p>

      {CAPABILITY_GROUPS.map((group) => {
        // Only light the group buttons up when the whole group already agrees,
        // otherwise a mixed group would look like it had been set in bulk.
        const uniform = group.capabilities.every((c) => settings[c] === settings[group.capabilities[0]]);
        return (
          <section key={group.id} className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{group.label}</h4>
              <SettingButtons
                value={uniform ? settings[group.capabilities[0]] : null}
                onPick={(option) => setGroup(group.capabilities, option)}
                subtle={!uniform}
              />
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {group.capabilities.map((cap) => {
                const setting = settings[cap];
                const inherited = defaults.has(cap) ? "allowed" : "blocked";
                return (
                  <li key={cap} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm">
                      {CAPABILITY_LABELS[cap]}
                      {setting === "default" && (
                        <span className="ml-2 text-xs text-muted">({inherited} by role)</span>
                      )}
                    </span>
                    <SettingButtons value={setting} onPick={(option) => setOne(cap, option)} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

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
