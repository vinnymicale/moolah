// Guards on the confirm endpoint. This is where a staged write becomes a real
// one, and the descriptor it takes came back from the browser, so every guard
// in front of commitWrite is load-bearing.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/chat-writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-writes")>()),
  commitWrite: vi.fn(),
}));

import { auth } from "@/auth";
import { isDemoMode } from "@/lib/demo-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { commitWrite } from "@/lib/chat-writes";
import { POST } from "./route";

const authMock = vi.mocked(auth);
const demoMock = vi.mocked(isDemoMode);
const rateLimit = vi.mocked(checkRateLimit);
const commit = vi.mocked(commitWrite);

const staged = {
  id: "w1",
  summary: "Expense: Market run for $42.50",
  fields: [{ label: "Amount", value: "$42.50" }],
  tool: "create_transaction",
  payload: {
    type: "EXPENSE",
    amount: 42.5,
    date: "2026-06-01",
    description: "Market run",
    note: null,
    categoryId: "c1",
    accountId: "a1",
    cleared: true,
  },
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/chat/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } } as never);
  demoMock.mockReturnValue(false);
  rateLimit.mockReturnValue({ allowed: true, retryAfterSec: 0 } as never);
  commit.mockResolvedValue("Saved Market run for $42.50.");
});

describe("POST /api/chat/confirm", () => {
  it("commits a valid staged write", async () => {
    const res = await POST(post({ staged }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Saved Market run for $42.50." });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }), "u1");
  });

  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await POST(post({ staged }));
    expect(res.status).toBe(401);
    expect(commit).not.toHaveBeenCalled();
  });

  it("refuses to write in demo mode", async () => {
    demoMock.mockReturnValue(true);
    const res = await POST(post({ staged }));
    expect(res.status).toBe(403);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rate limits per user", async () => {
    rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 30 } as never);
    const res = await POST(post({ staged }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a descriptor the client tampered with", async () => {
    const res = await POST(post({ staged: { ...staged, payload: { ...staged.payload, amount: -1 } } }));
    expect(res.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects an unknown tool", async () => {
    const res = await POST(post({ staged: { ...staged, tool: "delete_everything" } }));
    expect(res.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat/confirm", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("hides the underlying error when a commit fails", async () => {
    commit.mockRejectedValue(new Error("Unknown category or account."));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ staged }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't save that change." });
  });
});
