// Every mutating action must refuse a member who lacks its capability. A page
// that forgets its gate leaks a view; an action that forgets one leaks a write.
//
// The static sweep is the real safety net: it reads each action file and checks
// that every exported mutator reaches a gate, which covers all ~70 of them. The
// runtime cases below prove the gate actually rejects, on a representative few.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const ACTIONS_DIR = join(process.cwd(), "src/actions");

/** Which gate each action file's mutating exports must use. */
const GATES: Record<string, string[]> = {
  "accounts.ts": ["MANAGE_ACCOUNTS"],
  "budgets.ts": ["MANAGE_BUDGETS"],
  "budget-suggestions.ts": ["MANAGE_BUDGETS", "VIEW_BUDGETS"],
  "categories.ts": ["MANAGE_CATEGORIES"],
  "goals.ts": ["MANAGE_GOALS"],
  "recurring.ts": ["MANAGE_RECURRING", "VIEW_TRANSACTIONS"],
  "rules.ts": ["MANAGE_RULES", "VIEW_RULES"],
  "transactions.ts": ["EDIT_TRANSACTIONS", "VIEW_TRANSACTIONS"],
  "import.ts": ["EDIT_TRANSACTIONS"],
  "tags.ts": ["EDIT_TRANSACTIONS"],
  "retirement.ts": ["MANAGE_GOALS"],
};

function read(file: string): string {
  return readFileSync(join(ACTIONS_DIR, file), "utf8");
}

/** Exported server actions, in source order, with the body up to the next export. */
function exportedActions(source: string): { name: string; body: string }[] {
  const starts: { name: string; at: number }[] = [];
  const re = /^export async function (\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) starts.push({ name: m[1], at: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
  }));
}

describe("every action file gates its exports", () => {
  for (const [file, capabilities] of Object.entries(GATES)) {
    describe(file, () => {
      const source = read(file);

      it("imports requireCapability rather than bare requireHousehold", () => {
        expect(source).toContain("requireCapability");
      });

      it("uses only the capabilities mapped to it", () => {
        const used = [...source.matchAll(/requireCapability\("(\w+)"\)/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(0);
        expect([...new Set(used)].sort()).toEqual(
          [...new Set(used.filter((c) => capabilities.includes(c)))].sort(),
        );
      });

      for (const { name, body } of exportedActions(source)) {
        it(`${name} reaches a gate`, () => {
          expect(body).toMatch(/requireCapability\(|requireAdmin\(/);
        });
      }
    });
  }
});

describe("bare requireHousehold is gone from actions", () => {
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
  for (const file of files) {
    // Notifications stay personal - they are scoped to the user, not gated by a
    // household capability - and settings/backup use their own admin checks.
    if (file === "notifications.ts") continue;
    it(`${file} calls no unguarded requireHousehold`, () => {
      expect(read(file)).not.toMatch(/\bawait requireHousehold\(\)/);
    });
  }
});

describe("notifications stay per-user", () => {
  it("uses requireUser and no household capability", () => {
    const source = read("notifications.ts");
    expect(source).toContain("requireUser");
    expect(source).not.toContain("requireCapability");
  });
});

describe("admin-only actions require an admin", () => {
  for (const file of ["settings.ts", "backup.ts", "household.ts"]) {
    const source = read(file);
    for (const { name, body } of exportedActions(source)) {
      it(`${file} ${name} checks admin`, () => {
        expect(body).toMatch(/requireAdmin\(|requireCredentialAdmin\(/);
      });
    }
  }
});

// The static sweep proves a gate is present; these prove it rejects.
class TestForbiddenError extends Error {}
const requireCapability = vi.fn();
// A literal factory, not importOriginal - the real module pulls in next-auth,
// which does not load under the node test environment.
vi.mock("@/lib/household", () => ({
  requireCapability,
  requireAdmin: vi.fn(),
  requireHousehold: vi.fn(),
  ForbiddenError: TestForbiddenError,
}));
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const CASES: { capability: string; action: () => Promise<unknown> }[] = [
  {
    capability: "MANAGE_BUDGETS",
    action: async () =>
      (await import("./budgets")).setBudgetAction({ categoryId: "c1", month: "2026-09-01", limit: 100 }),
  },
  {
    capability: "MANAGE_CATEGORIES",
    action: async () => (await import("./categories")).createCategoryAction({ name: "X", kind: "EXPENSE" }),
  },
  {
    capability: "MANAGE_GOALS",
    action: async () => (await import("./goals")).createGoalAction({ name: "X", targetAmount: 100 }),
  },
];

describe("a gated action rejects a member without the capability", () => {
  for (const { capability, action } of CASES) {
    it(`rejects without ${capability}`, async () => {
      requireCapability.mockRejectedValue(new TestForbiddenError(capability));
      const result = (await action()) as { ok: boolean; error?: string };
      expect(result.ok).toBe(false);
      expect(requireCapability).toHaveBeenCalledWith(capability);
    });
  }
});
