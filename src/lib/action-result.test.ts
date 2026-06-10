import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { run, UserError } from "./action-result";

describe("run", () => {
  it("returns ok on success", async () => {
    expect(await run(async () => {})).toEqual({ ok: true });
  });

  it("surfaces UserError messages to the client", async () => {
    const result = await run(async () => {
      throw new UserError("Account not found");
    });
    expect(result).toEqual({ ok: false, error: "Account not found" });
  });

  it("surfaces the first zod issue", async () => {
    const schema = z.object({ amount: z.number().positive("Amount must be greater than zero") });
    const result = await run(async () => {
      schema.parse({ amount: -5 });
    });
    expect(result).toEqual({ ok: false, error: "Amount must be greater than zero" });
  });

  it("hides unexpected error internals behind a generic message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await run(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432 (db internals)");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("ECONNREFUSED");
      expect(result.error).toMatch(/something went wrong/i);
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rethrows Next.js redirect control-flow errors", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/signin;307;",
    });
    await expect(
      run(async () => {
        throw redirectError;
      }),
    ).rejects.toBe(redirectError);
  });
});
