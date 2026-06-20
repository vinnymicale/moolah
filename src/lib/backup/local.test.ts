import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { LocalDestination } from "./local";

describe("LocalDestination", () => {
  let dir: string;
  let dest: LocalDestination;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "moolah-backup-"));
    dest = new LocalDestination(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a backup that can be read back", async () => {
    const name = "moolah-backup-2026-06-12_04-30-08.json";
    await dest.put(name, Buffer.from('{"app":"moolah"}'));
    const written = await readFile(resolve(dir, name), "utf8");
    expect(written).toBe('{"app":"moolah"}');
  });

  it("lists only backup files, ignoring other files in the dir", async () => {
    await dest.put("moolah-backup-2026-06-12_04-30-08.json", Buffer.from("{}"));
    await dest.put("moolah-backup-2026-06-05_02-46-56.json", Buffer.from("{}"));
    await writeFile(resolve(dir, "unrelated.txt"), "hi");

    const listed = (await dest.list()).map((b) => b.name).sort();
    expect(listed).toEqual([
      "moolah-backup-2026-06-05_02-46-56.json",
      "moolah-backup-2026-06-12_04-30-08.json",
    ]);
  });

  it("returns an empty list when the directory doesn't exist yet", async () => {
    const missing = new LocalDestination(resolve(dir, "does-not-exist"));
    expect(await missing.list()).toEqual([]);
  });

  it("deletes a backup", async () => {
    const name = "moolah-backup-2026-06-12_04-30-08.json";
    await dest.put(name, Buffer.from("{}"));
    await dest.delete(name);
    expect(await dest.list()).toEqual([]);
  });
});
