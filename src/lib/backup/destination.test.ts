import { describe, it, expect } from "vitest";
import { isBackupName, namesToPrune } from "./destination";

describe("isBackupName", () => {
  it("matches our backup files and nothing else", () => {
    expect(isBackupName("moolah-backup-2026-06-12_04-30-08.json")).toBe(true);
    expect(isBackupName("notes.json")).toBe(false);
    expect(isBackupName("moolah-backup-2026-06-12_04-30-08.txt")).toBe(false);
    expect(isBackupName("README.md")).toBe(false);
  });
});

describe("namesToPrune", () => {
  // Three backups in random order; their embedded timestamps define age.
  const names = [
    "moolah-backup-2026-06-12_04-30-08.json",
    "moolah-backup-2026-06-05_02-46-56.json",
    "moolah-backup-2026-06-08_16-53-50.json",
  ];

  it("returns nothing when under the keep count", () => {
    expect(namesToPrune(names, 5)).toEqual([]);
    expect(namesToPrune(names, 3)).toEqual([]);
  });

  it("prunes the oldest beyond the keep count", () => {
    expect(namesToPrune(names, 2)).toEqual(["moolah-backup-2026-06-05_02-46-56.json"]);
    expect(namesToPrune(names, 1)).toEqual([
      "moolah-backup-2026-06-05_02-46-56.json",
      "moolah-backup-2026-06-08_16-53-50.json",
    ]);
  });

  it("prunes everything when keepCount is zero or negative", () => {
    expect(namesToPrune(names, 0).sort()).toEqual([...names].sort());
  });

  it("ignores files that aren't our backups", () => {
    const mixed = [...names, "random.json", "moolah-backup-bad.txt"];
    expect(namesToPrune(mixed, 2)).toEqual(["moolah-backup-2026-06-05_02-46-56.json"]);
  });
});
