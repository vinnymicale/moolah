import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_LABELS,
  isCapability,
  resolveCapabilities,
  roleDefaults,
} from "./capabilities";

describe("roleDefaults", () => {
  it("gives OWNER and ADMIN every capability", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(roleDefaults(role).size).toBe(CAPABILITIES.length);
    }
  });

  it("gives VIEWER only view capabilities", () => {
    const caps = [...roleDefaults("VIEWER")];
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((c) => c.startsWith("VIEW_"))).toBe(true);
  });

  // The assistant reads the whole ledger and spends the household's API key, so
  // looking at a page and interrogating it are deliberately not the same right.
  it("withholds the assistant from VIEWER", () => {
    expect(roleDefaults("VIEWER").has("USE_CHAT")).toBe(false);
  });

  it("gives MEMBER views plus everyday edits but not structural management", () => {
    const caps = roleDefaults("MEMBER");
    expect(caps.has("VIEW_TRANSACTIONS")).toBe(true);
    expect(caps.has("EDIT_TRANSACTIONS")).toBe(true);
    expect(caps.has("MANAGE_BUDGETS")).toBe(true);
    expect(caps.has("MANAGE_GOALS")).toBe(true);
    expect(caps.has("MANAGE_RECURRING")).toBe(true);
    expect(caps.has("MANAGE_RETIREMENT")).toBe(true);
    expect(caps.has("USE_CHAT")).toBe(true);
    expect(caps.has("MANAGE_CATEGORIES")).toBe(false);
    expect(caps.has("MANAGE_RULES")).toBe(false);
    expect(caps.has("MANAGE_ACCOUNTS")).toBe(false);
    expect(caps.has("RUN_SYNC")).toBe(false);
    expect(caps.has("EXPORT_DATA")).toBe(false);
  });
});

describe("resolveCapabilities", () => {
  it("adds granted capabilities to the role defaults", () => {
    const caps = resolveCapabilities("VIEWER", ["EDIT_TRANSACTIONS"], []);
    expect(caps.has("EDIT_TRANSACTIONS")).toBe(true);
    expect(caps.has("VIEW_TRANSACTIONS")).toBe(true);
  });

  it("removes denied capabilities from the role defaults", () => {
    const caps = resolveCapabilities("MEMBER", [], ["VIEW_RETIREMENT"]);
    expect(caps.has("VIEW_RETIREMENT")).toBe(false);
  });

  it("lets deny win over grant so a single list can't contradict itself", () => {
    const caps = resolveCapabilities("VIEWER", ["MANAGE_RULES"], ["MANAGE_RULES"]);
    expect(caps.has("MANAGE_RULES")).toBe(false);
  });

  it("ignores overrides for OWNER and ADMIN so an admin can't be locked out", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const caps = resolveCapabilities(role, [], ["VIEW_DASHBOARD", "MANAGE_BUDGETS"]);
      expect(caps.size).toBe(CAPABILITIES.length);
    }
  });

  it("ignores unknown capability strings left over from an older release", () => {
    const caps = resolveCapabilities("VIEWER", ["NOT_A_REAL_CAP"], ["ALSO_FAKE"]);
    expect([...caps].every((c) => isCapability(c))).toBe(true);
  });
});

describe("isCapability", () => {
  it("accepts a known capability and rejects anything else", () => {
    expect(isCapability("VIEW_DASHBOARD")).toBe(true);
    expect(isCapability("VIEW_NONSENSE")).toBe(false);
  });
});

describe("CAPABILITY_GROUPS", () => {
  it("places every capability in exactly one group", () => {
    const seen = CAPABILITY_GROUPS.flatMap((g) => [...g.capabilities]);
    expect([...seen].sort()).toEqual([...CAPABILITIES].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("labels every capability", () => {
    for (const cap of CAPABILITIES) expect(CAPABILITY_LABELS[cap]).toBeTruthy();
  });
});
