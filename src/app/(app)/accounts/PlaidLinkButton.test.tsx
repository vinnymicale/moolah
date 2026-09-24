/**
 * @vitest-environment jsdom
 */

// A member without MANAGE_ACCOUNTS or RUN_SYNC used to see the full row of
// controls and get a 403 on every one of them. The routes were always gated;
// only the affordances leaked. These pin the flags to the buttons, since a
// later edit to this JSX would otherwise put them back silently.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlaidItemDTO } from "@/lib/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("react-plaid-link", () => ({ usePlaidLink: () => ({ open: vi.fn(), ready: true }) }));
vi.mock("@/actions/transactions", () => ({
  scanDuplicateTransactionsAction: vi.fn(),
  removeDuplicateTransactionsAction: vi.fn(),
  ignoreDuplicateGroupAction: vi.fn(),
}));

const { PlaidItemsList } = await import("./PlaidLinkButton");
const { ToastProvider } = await import("@/components/Toast");

const ITEMS: PlaidItemDTO[] = [
  {
    id: "item_1",
    institutionName: "Test Bank",
    institutionId: "ins_1",
    lastSyncedAt: null,
    error: null,
    linkedAccounts: [
      {
        id: "la_1",
        plaidAccountId: "acct_1",
        financialAccountId: "fa_1",
        name: "Checking",
        officialName: null,
        mask: "1234",
        plaidType: "depository",
        plaidSubtype: "checking",
        availableBalance: 100,
        currentBalance: 100,
      },
    ],
  },
];

function renderList(caps: { canManageAccounts: boolean; canSync: boolean; canDedup: boolean }) {
  render(
    <ToastProvider>
      <PlaidItemsList items={ITEMS} {...caps} />
    </ToastProvider>,
  );
}

const ALL = { canManageAccounts: true, canSync: true, canDedup: true };
const NONE = { canManageAccounts: false, canSync: false, canDedup: false };

describe("PlaidItemsList capability gating", () => {
  it("shows every control to a user with all three capabilities", () => {
    renderList(ALL);
    expect(screen.getByText("Find duplicates")).toBeTruthy();
    expect(screen.getByText("Re-import all")).toBeTruthy();
    expect(screen.getByText("Add accounts")).toBeTruthy();
    expect(screen.getByText("Reconnect")).toBeTruthy();
    expect(screen.getByText("Sync")).toBeTruthy();
    expect(screen.getByLabelText("Disconnect Test Bank")).toBeTruthy();
  });

  it("keeps the card and the bank visible with no capabilities", () => {
    renderList(NONE);
    expect(screen.getByText("Connected banks")).toBeTruthy();
    expect(screen.getByText("Test Bank")).toBeTruthy();
  });

  it("hides every control from a user with no capabilities", () => {
    renderList(NONE);
    expect(screen.queryByText("Find duplicates")).toBeNull();
    expect(screen.queryByText("Re-import all")).toBeNull();
    expect(screen.queryByText("Add accounts")).toBeNull();
    expect(screen.queryByText("Reconnect")).toBeNull();
    expect(screen.queryByText("Sync")).toBeNull();
    expect(screen.queryByLabelText("Disconnect Test Bank")).toBeNull();
  });

  it("ties add, reconnect and disconnect to MANAGE_ACCOUNTS alone", () => {
    renderList({ ...NONE, canManageAccounts: true });
    expect(screen.getByText("Add accounts")).toBeTruthy();
    expect(screen.getByText("Reconnect")).toBeTruthy();
    expect(screen.getByLabelText("Disconnect Test Bank")).toBeTruthy();
    expect(screen.queryByText("Sync")).toBeNull();
    expect(screen.queryByText("Re-import all")).toBeNull();
  });

  it("ties sync and re-import to RUN_SYNC alone", () => {
    renderList({ ...NONE, canSync: true });
    expect(screen.getByText("Sync")).toBeTruthy();
    expect(screen.getByText("Re-import all")).toBeTruthy();
    expect(screen.queryByText("Add accounts")).toBeNull();
    expect(screen.queryByLabelText("Disconnect Test Bank")).toBeNull();
  });

  it("ties the duplicate finder to EDIT_TRANSACTIONS alone", () => {
    renderList({ ...NONE, canDedup: true });
    expect(screen.getByText("Find duplicates")).toBeTruthy();
    expect(screen.queryByText("Re-import all")).toBeNull();
  });
});
