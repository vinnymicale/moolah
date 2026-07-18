import { describe, it, expect, vi } from "vitest";
import { nameToEmail } from "./user-setup";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("nameToEmail", () => {
  it("lowercases and appends the local domain", () => {
    expect(nameToEmail("Alex")).toBe("alex@moolah.local");
  });

  it("joins multi-word names with dots", () => {
    expect(nameToEmail("Jane Doe")).toBe("jane.doe@moolah.local");
  });

  it("trims surrounding whitespace and collapses inner runs", () => {
    expect(nameToEmail("  Jane   Doe  ")).toBe("jane.doe@moolah.local");
  });

  it("is stable across casing so the same person maps to one account", () => {
    expect(nameToEmail("JANE DOE")).toBe(nameToEmail("jane doe"));
  });
});
