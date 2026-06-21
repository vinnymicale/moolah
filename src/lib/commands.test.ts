import { describe, it, expect } from "vitest";
import { filterCommands, type Command } from "./commands";

const cmd = (id: string, label: string, keywords?: string): Command => ({
  id,
  label,
  keywords,
  run: () => {},
});

const ids = (cmds: Command[]) => cmds.map((c) => c.id);

describe("filterCommands", () => {
  const list = [
    cmd("a", "New transaction", "add create expense income"),
    cmd("b", "Import CSV", "upload bank statement"),
    cmd("c", "Transactions", "go to open transactions"),
    cmd("d", "Net worth", "go to open net worth"),
  ];

  it("returns everything in original order for an empty query", () => {
    expect(ids(filterCommands(list, ""))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterCommands(list, "   "))).toEqual(["a", "b", "c", "d"]);
  });

  it("matches against the label", () => {
    expect(ids(filterCommands(list, "import"))).toEqual(["b"]);
  });

  it("matches against hidden keywords", () => {
    // "upload" only appears in keywords, not the label.
    expect(ids(filterCommands(list, "upload"))).toEqual(["b"]);
  });

  it("is case-insensitive", () => {
    expect(ids(filterCommands(list, "IMPORT"))).toEqual(["b"]);
  });

  it("requires every whitespace-separated term to match", () => {
    expect(ids(filterCommands(list, "net worth"))).toEqual(["d"]);
    // "net" matches d's label/keywords but "csv" matches nothing it shares.
    expect(filterCommands(list, "net csv")).toEqual([]);
  });

  it("matches terms across label and keywords together", () => {
    // "new" from the label, "expense" from the keywords.
    expect(ids(filterCommands(list, "new expense"))).toEqual(["a"]);
  });

  it("ranks a label prefix above a substring above keywords-only", () => {
    const ranked = [
      cmd("sub", "A transaction list", "x"),
      cmd("kw", "Spending", "transaction history"),
      cmd("pre", "Transaction detail", "x"),
    ];
    expect(ids(filterCommands(ranked, "transaction"))).toEqual(["pre", "sub", "kw"]);
  });

  it("keeps input order on ties", () => {
    const tied = [
      cmd("first", "Go first", "go"),
      cmd("second", "Go second", "go"),
    ];
    expect(ids(filterCommands(tied, "go"))).toEqual(["first", "second"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCommands(list, "zzzzz")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const original = [...list];
    filterCommands(list, "transaction");
    expect(list).toEqual(original);
  });
});
