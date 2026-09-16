// Reconnect ("Sync") has to reconcile the account list, not just pull
// transactions. syncPlaidItem skips any Plaid account it has no row for, so
// without syncPlaidAccounts a reconnect can never surface an account the user
// just authorized at the bank.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plaidItem: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/plaid", () => ({ getPlaidClient: vi.fn() }));
vi.mock("@/lib/plaid-accounts", () => ({ syncPlaidAccounts: vi.fn() }));
vi.mock("@/lib/plaid-sync", () => ({ syncPlaidItem: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn((v: string) => `dec:${v}`) }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPlaidClient } from "@/lib/plaid";
import { syncPlaidAccounts } from "@/lib/plaid-accounts";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { POST } from "./route";

const params = Promise.resolve({ itemId: "item_1" });
const req = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(prisma.plaidItem.findFirst).mockResolvedValue({
    id: "item_1",
    accessToken: "enc",
    institutionName: "Some Bank",
  } as never);
  vi.mocked(getPlaidClient).mockResolvedValue({} as never);
  vi.mocked(syncPlaidAccounts).mockResolvedValue({ added: 0, updated: 2 });
  vi.mocked(syncPlaidItem).mockResolvedValue({ added: 5, updated: 1 } as never);
});

describe("POST /api/plaid/sync/[itemId]", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
  });

  it("404s on an item belonging to someone else", async () => {
    vi.mocked(prisma.plaidItem.findFirst).mockResolvedValue(null as never);
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
  });

  it("reconciles accounts before pulling transactions", async () => {
    vi.mocked(syncPlaidAccounts).mockResolvedValue({ added: 1, updated: 2 });

    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(syncPlaidAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "dec:enc",
        plaidItemRowId: "item_1",
        userId: "u1",
        institutionName: "Some Bank",
      }),
    );
    expect(syncPlaidItem).toHaveBeenCalledWith("item_1", "u1");
  });

  // Both syncs report "added"; the account count has to stay separate from the
  // transaction count or the toast lies about what happened.
  it("keeps the account counts out of the transaction counts", async () => {
    vi.mocked(syncPlaidAccounts).mockResolvedValue({ added: 1, updated: 2 });

    const res = await POST(req, { params });
    const body = await res.json();

    expect(body).toMatchObject({
      ok: true,
      added: 5,
      updated: 1,
      accounts: { added: 1, updated: 2 },
    });
  });

  it("records the failure on the item when Plaid errors", async () => {
    vi.mocked(syncPlaidAccounts).mockRejectedValue(new Error("ITEM_LOGIN_REQUIRED"));
    vi.mocked(prisma.plaidItem.update).mockResolvedValue({ failureCount: 1 } as never);

    const res = await POST(req, { params });

    expect(res.status).toBe(500);
    expect(prisma.plaidItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item_1" } }),
    );
  });
});
