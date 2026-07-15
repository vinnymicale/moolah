import { describe, it, expect } from "vitest";
import { evaluateRules, ruleMatches, splitByRatio, type RuleLike, type TxnFacts } from "./rules";

const facts = (over: Partial<TxnFacts> = {}): TxnFacts => ({
  description: "COSTCO WHSE #123",
  amountDollars: 80,
  accountId: "acc1",
  type: "EXPENSE",
  ...over,
});

const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: "r1",
  priority: 0,
  enabled: true,
  conditions: [{ type: "descriptionContains", value: "costco" }],
  actions: [{ type: "setCategory", categoryId: "groceries" }],
  ...over,
});

describe("ruleMatches", () => {
  it("ANDs all conditions", () => {
    const r = rule({
      conditions: [
        { type: "descriptionContains", value: "costco" },
        { type: "amountRange", min: 50 },
      ],
    });
    expect(ruleMatches(r, facts({ amountDollars: 80 }))).toBe(true);
    expect(ruleMatches(r, facts({ amountDollars: 20 }))).toBe(false);
  });

  it("never matches a rule with no conditions", () => {
    expect(ruleMatches(rule({ conditions: [] }), facts())).toBe(false);
  });

  it("never matches a disabled rule", () => {
    expect(ruleMatches(rule({ enabled: false }), facts())).toBe(false);
  });

  it("matches description case-insensitively, account, and type", () => {
    expect(ruleMatches(rule({ conditions: [{ type: "descriptionContains", value: "WHSE" }] }), facts())).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ type: "account", accountId: "acc1" }] }), facts())).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ type: "account", accountId: "other" }] }), facts())).toBe(false);
    expect(ruleMatches(rule({ conditions: [{ type: "type", txnType: "INCOME" }] }), facts())).toBe(false);
  });

  it("treats an amountRange with no bounds as a non-match", () => {
    expect(ruleMatches(rule({ conditions: [{ type: "amountRange" }] }), facts())).toBe(false);
  });

  it("honors inclusive amount range edges", () => {
    const r = rule({ conditions: [{ type: "amountRange", min: 50, max: 80 }] });
    expect(ruleMatches(r, facts({ amountDollars: 50 }))).toBe(true);
    expect(ruleMatches(r, facts({ amountDollars: 80 }))).toBe(true);
    expect(ruleMatches(r, facts({ amountDollars: 80.01 }))).toBe(false);
  });
});

describe("evaluateRules", () => {
  it("first matching rule wins for single-valued effects (priority order)", () => {
    const effect = evaluateRules(facts(), [
      rule({ id: "b", priority: 5, actions: [{ type: "setCategory", categoryId: "late" }] }),
      rule({ id: "a", priority: 1, actions: [{ type: "setCategory", categoryId: "early" }] }),
    ]);
    expect(effect.categoryId).toBe("early");
  });

  it("merges effects from different rules", () => {
    const effect = evaluateRules(facts(), [
      rule({ id: "a", priority: 1, actions: [{ type: "setCategory", categoryId: "groceries" }] }),
      rule({ id: "b", priority: 2, actions: [{ type: "rewriteDescription", to: "Costco" }] }),
      rule({ id: "c", priority: 3, actions: [{ type: "markTransfer" }] }),
    ]);
    expect(effect).toEqual({ categoryId: "groceries", description: "Costco", markTransfer: true });
  });

  it("a split supersedes setCategory", () => {
    const effect = evaluateRules(facts(), [
      rule({ id: "a", priority: 1, actions: [{ type: "setCategory", categoryId: "groceries" }] }),
      rule({
        id: "b",
        priority: 2,
        actions: [{ type: "split", parts: [{ categoryId: "g", ratio: 0.6 }, { categoryId: "h", ratio: 0.4 }] }],
      }),
    ]);
    expect(effect.categoryId).toBeUndefined();
    expect(effect.splits).toHaveLength(2);
  });

  it("returns an empty effect when nothing matches", () => {
    expect(evaluateRules(facts({ description: "Trader Joes" }), [rule({})])).toEqual({});
  });
});

describe("addTag actions", () => {
  it("accumulates tags across matching rules and dedups", () => {
    const rules: RuleLike[] = [
      rule({ id: "r1", priority: 0, actions: [{ type: "addTag", tagId: "a" }] }),
      rule({
        id: "r2",
        priority: 1,
        actions: [
          { type: "addTag", tagId: "b" },
          { type: "addTag", tagId: "a" },
        ],
      }),
    ];
    expect(evaluateRules(facts(), rules).addTagIds).toEqual(["a", "b"]);
  });

  it("is exempt from first-wins: later rules still add tags", () => {
    const rules: RuleLike[] = [
      rule({
        id: "r1",
        priority: 0,
        actions: [
          { type: "setCategory", categoryId: "c1" },
          { type: "addTag", tagId: "a" },
        ],
      }),
      rule({
        id: "r2",
        priority: 1,
        actions: [
          { type: "setCategory", categoryId: "c2" },
          { type: "addTag", tagId: "b" },
        ],
      }),
    ];
    const effect = evaluateRules(facts(), rules);
    expect(effect.categoryId).toBe("c1");
    expect(effect.addTagIds).toEqual(["a", "b"]);
  });

  it("keeps tags when a split clears the category", () => {
    const rules: RuleLike[] = [
      rule({
        id: "r1",
        priority: 0,
        actions: [
          {
            type: "split",
            parts: [
              { categoryId: "c1", ratio: 0.5 },
              { categoryId: "c2", ratio: 0.5 },
            ],
          },
          { type: "addTag", tagId: "a" },
        ],
      }),
    ];
    const effect = evaluateRules(facts(), rules);
    expect(effect.addTagIds).toEqual(["a"]);
    expect(effect.categoryId).toBeUndefined();
  });

  it("leaves addTagIds undefined when no rule adds a tag", () => {
    expect(evaluateRules(facts(), [rule({})]).addTagIds).toBeUndefined();
  });
});

describe("splitByRatio", () => {
  it("produces cent-exact parts that sum to the total", () => {
    const parts = splitByRatio(10000, [
      { categoryId: "a", ratio: 1 },
      { categoryId: "b", ratio: 1 },
      { categoryId: "c", ratio: 1 },
    ]);
    expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(10000);
    // 10000/3 = 3333.33 -> two get the extra cents via largest remainder.
    expect(parts.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([3333, 3334, 3333].sort((a, b) => a - b));
  });

  it("normalizes ratios that don't sum to 1", () => {
    const parts = splitByRatio(1000, [
      { categoryId: "a", ratio: 3 },
      { categoryId: "b", ratio: 1 },
    ]);
    expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(1000);
    expect(parts[0].amountCents).toBe(750);
    expect(parts[1].amountCents).toBe(250);
  });

  it("returns nothing for a zero total ratio", () => {
    expect(splitByRatio(1000, [{ categoryId: "a", ratio: 0 }])).toEqual([]);
  });
});
