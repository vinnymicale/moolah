import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { isAsset, toAccountType, syncPlaidAccounts } from "./plaid-accounts";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    plaidLinkedAccount: { findUnique: vi.fn(), upsert: vi.fn() },
    financialAccount: { create: vi.fn(), update: vi.fn() },
  },
}));

describe("isAsset", () => {
  it("treats depository and investment accounts as assets", () => {
    expect(isAsset("depository", "checking")).toBe(true);
    expect(isAsset("investment", "brokerage")).toBe(true);
  });

  it("treats credit and loan accounts as liabilities", () => {
    expect(isAsset("credit", "credit card")).toBe(false);
    expect(isAsset("loan", "student loan")).toBe(false);
    expect(isAsset("depository", "mortgage")).toBe(false);
  });
});

describe("toAccountType", () => {
  it("maps the common subtypes", () => {
    expect(toAccountType("depository", "checking")).toBe("CHECKING");
    expect(toAccountType("depository", "savings")).toBe("SAVINGS");
    expect(toAccountType("credit", "credit card")).toBe("CREDIT_CARD");
    expect(toAccountType("investment", "401k")).toBe("RETIREMENT");
    expect(toAccountType("loan", "mortgage")).toBe("LOAN");
  });

  it("falls back to the account type when the subtype is unknown", () => {
    expect(toAccountType("credit", null)).toBe("CREDIT_CARD");
    expect(toAccountType("investment", null)).toBe("INVESTMENT");
    expect(toAccountType("depository", "weird")).toBe("CHECKING");
  });
});

function clientReturning(accounts: unknown[]) {
  return { accountsGet: vi.fn().mockResolvedValue({ data: { accounts } }) } as never;
}

function plaidAccount(over: Record<string, unknown> = {}) {
  return {
    account_id: "acct_1",
    name: "Everyday Checking",
    official_name: null,
    mask: "1234",
    type: "depository",
    subtype: "checking",
    balances: { current: 100, available: 90 },
    ...over,
  };
}

const ARGS = {
  plaidItemRowId: "item_row_1",
  householdId: "h1",
  institutionName: "Some Bank",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.plaidLinkedAccount.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.financialAccount.update).mockResolvedValue({} as never);
  vi.mocked(prisma.financialAccount.create).mockResolvedValue({ id: "fin_new" } as never);
});

describe("syncPlaidAccounts", () => {
  it("creates a FinancialAccount for an account it has not seen before", async () => {
    vi.mocked(prisma.plaidLinkedAccount.findUnique).mockResolvedValue(null as never);

    const result = await syncPlaidAccounts({
      ...ARGS,
      plaidClient: clientReturning([plaidAccount()]),
      accessToken: "tok",
    });

    expect(result).toEqual({ added: 1, updated: 0 });
    expect(prisma.financialAccount.create).toHaveBeenCalledTimes(1);
    const created = vi.mocked(prisma.financialAccount.create).mock.calls[0][0].data;
    expect(created).toMatchObject({
      householdId: "h1",
      name: "Everyday Checking",
      type: "CHECKING",
      institution: "Some Bank",
      isAsset: true,
      includeInCash: true,
    });
  });

  it("reuses the existing FinancialAccount so history survives a re-link", async () => {
    vi.mocked(prisma.plaidLinkedAccount.findUnique).mockResolvedValue(
      { financialAccountId: "fin_existing" } as never,
    );

    const result = await syncPlaidAccounts({
      ...ARGS,
      plaidClient: clientReturning([plaidAccount()]),
      accessToken: "tok",
    });

    expect(result).toEqual({ added: 0, updated: 1 });
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
    expect(prisma.financialAccount.update).toHaveBeenCalledWith({
      where: { id: "fin_existing" },
      data: { currentBalance: 100, institution: "Some Bank", archived: false },
    });
  });

  // Archiving hid the account from the accounts page, so re-authorizing it at
  // the bank has to unarchive it - otherwise we silently update a row the user
  // cannot see and tell them nothing was added.
  it("unarchives an account the user re-authorizes and counts it as added", async () => {
    vi.mocked(prisma.plaidLinkedAccount.findUnique).mockResolvedValue(
      { financialAccountId: "fin_archived", financialAccount: { archived: true } } as never,
    );

    const result = await syncPlaidAccounts({
      ...ARGS,
      plaidClient: clientReturning([plaidAccount()]),
      accessToken: "tok",
    });

    expect(result).toEqual({ added: 1, updated: 0 });
    expect(prisma.financialAccount.create).not.toHaveBeenCalled();
    expect(prisma.financialAccount.update).toHaveBeenCalledWith({
      where: { id: "fin_archived" },
      data: { currentBalance: 100, institution: "Some Bank", archived: false },
    });
  });

  // The bug this module exists for: an account authorized later via Account
  // Select must be created while the ones already linked are left alone.
  it("adds only the newly authorized account when the bank is already linked", async () => {
    vi.mocked(prisma.plaidLinkedAccount.findUnique).mockImplementation((async (args: {
      where: { plaidAccountId: string };
    }) =>
      args.where.plaidAccountId === "acct_1"
        ? { financialAccountId: "fin_existing" }
        : null) as never);

    const result = await syncPlaidAccounts({
      ...ARGS,
      plaidClient: clientReturning([
        plaidAccount(),
        plaidAccount({ account_id: "acct_2", name: "New Savings", subtype: "savings" }),
      ]),
      accessToken: "tok",
    });

    expect(result).toEqual({ added: 1, updated: 1 });
    expect(prisma.financialAccount.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.financialAccount.create).mock.calls[0][0].data).toMatchObject({
      name: "New Savings",
      type: "SAVINGS",
    });
  });

  it("links every account row to the item that was passed in", async () => {
    vi.mocked(prisma.plaidLinkedAccount.findUnique).mockResolvedValue(null as never);

    await syncPlaidAccounts({
      ...ARGS,
      plaidClient: clientReturning([plaidAccount()]),
      accessToken: "tok",
    });

    const call = vi.mocked(prisma.plaidLinkedAccount.upsert).mock.calls[0][0];
    expect(call.where).toEqual({ plaidAccountId: "acct_1" });
    expect(call.create).toMatchObject({ plaidItemId: "item_row_1", financialAccountId: "fin_new" });
    expect(call.update).toMatchObject({ plaidItemId: "item_row_1" });
  });
});
