// The account picker hands back what the user ticked, but Plaid populates a
// newly selected account asynchronously, so /accounts/get can still be serving
// the old list when Link closes. These cover the polling that papers over that
// gap, and the response shape the toast reads to decide what to say.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plaidItem: { findFirst: vi.fn() },
    plaidLinkedAccount: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/plaid", () => ({ getPlaidClient: vi.fn() }));
vi.mock("@/lib/plaid-accounts", () => ({ syncPlaidAccounts: vi.fn() }));
vi.mock("@/lib/plaid-sync", () => ({ syncPlaidItem: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn(() => "access-token") }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPlaidClient } from "@/lib/plaid";
import { syncPlaidAccounts } from "@/lib/plaid-accounts";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { POST } from "./route";

const authMock = vi.mocked(auth);
const findItem = vi.mocked(prisma.plaidItem.findFirst);
const findLinked = vi.mocked(prisma.plaidLinkedAccount.findMany);
const syncAccounts = vi.mocked(syncPlaidAccounts);
const syncItem = vi.mocked(syncPlaidItem);

function post(body: unknown): Request {
  return new Request("http://localhost/api/plaid/refresh-accounts/item-1", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ itemId: "item-1" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  authMock.mockResolvedValue({ user: { id: "u1" } } as never);
  findItem.mockResolvedValue({
    id: "item-1",
    userId: "u1",
    accessToken: "enc",
    institutionName: "Test Bank",
  } as never);
  findLinked.mockResolvedValue([] as never);
  vi.mocked(getPlaidClient).mockResolvedValue({} as never);
  syncAccounts.mockResolvedValue({ added: 0, updated: 0 });
  syncItem.mockResolvedValue({ added: 0, modified: 0, removed: 0, balancesUpdated: 0 } as never);
});

/** Drives the route to completion while fake timers are in play. */
async function run(body: unknown) {
  const promise = POST(post(body) as never, { params });
  await vi.runAllTimersAsync();
  return promise;
}

describe("POST /api/plaid/refresh-accounts/[itemId]", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await run({});
    expect(res.status).toBe(401);
  });

  it("404s on an item belonging to someone else", async () => {
    findItem.mockResolvedValue(null as never);
    const res = await run({});
    expect(res.status).toBe(404);
  });

  it("reports the account count, not the transaction count", async () => {
    syncAccounts.mockResolvedValue({ added: 1, updated: 2 });
    syncItem.mockResolvedValue({ added: 57, modified: 0, removed: 0, balancesUpdated: 3 } as never);

    const res = await run({});
    const json = await res.json();

    expect(json.added).toBe(1);
    expect(json.updated).toBe(2);
    expect(json.transactions.added).toBe(57);
  });

  it("does not poll when no selection was reported", async () => {
    await run({});
    expect(syncAccounts).toHaveBeenCalledTimes(1);
  });

  it("does not poll when every selected account is already stored", async () => {
    findLinked.mockResolvedValue([{ plaidAccountId: "acc-1" }] as never);
    const res = await run({ selectedAccountIds: ["acc-1"] });

    expect(syncAccounts).toHaveBeenCalledTimes(1);
    expect((await res.json()).missing).toBe(0);
  });

  it("retries until a slow account turns up", async () => {
    // Absent on the first read, stored by the time we look again.
    findLinked
      .mockResolvedValueOnce([] as never)
      .mockResolvedValue([{ plaidAccountId: "acc-1" }] as never);
    syncAccounts
      .mockResolvedValueOnce({ added: 0, updated: 1 })
      .mockResolvedValue({ added: 1, updated: 1 });

    const res = await run({ selectedAccountIds: ["acc-1"] });
    const json = await res.json();

    expect(syncAccounts).toHaveBeenCalledTimes(2);
    expect(json.added).toBe(1);
    expect(json.missing).toBe(0);
  });

  it("gives up after the poll budget and says what is still missing", async () => {
    const res = await run({ selectedAccountIds: ["acc-1"] });
    const json = await res.json();

    // One initial read plus the retries.
    expect(syncAccounts).toHaveBeenCalledTimes(4);
    expect(json.added).toBe(0);
    expect(json.missing).toBe(1);
  });

  it("ignores non-string entries in the selected ids", async () => {
    await run({ selectedAccountIds: [42, null, { id: "x" }] });
    expect(syncAccounts).toHaveBeenCalledTimes(1);
  });

  it("500s when Plaid fails", async () => {
    syncAccounts.mockRejectedValue(new Error("ITEM_LOGIN_REQUIRED"));
    const res = await run({});
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("ITEM_LOGIN_REQUIRED");
  });
});
