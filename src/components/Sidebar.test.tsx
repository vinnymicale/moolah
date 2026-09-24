/**
 * @vitest-environment jsdom
 */

// "Sync banks" posts to /api/plaid/sync-all, which requires RUN_SYNC. A member
// who was never granted it used to see the button and get a 403; a member who
// was granted it must still see it, which is the half that is easy to break
// while hiding the other.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NAV, type NavItem } from "./app-nav";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

const { Sidebar } = await import("./Sidebar");
const { ToastProvider } = await import("./Toast");

const noop = () => {};

function renderSidebar(extra: { canSync?: boolean; demoMode?: boolean }) {
  render(
    <ToastProvider>
      <Sidebar
        compact={false}
        allowCollapse
        user={{ name: "Member", email: "member@example.com", image: null }}
        authBypass={false}
        nav={NAV as unknown as NavItem[]}
        isActive={() => false}
        customized={false}
        onToggleCollapsed={noop}
        onAdd={noop}
        onSearch={noop}
        onImport={noop}
        onNavigate={noop}
        onShortcuts={noop}
        onReorder={noop}
        onResetOrder={noop}
        {...extra}
      />
    </ToastProvider>,
  );
}

describe("Sidebar sync button", () => {
  it("shows Sync banks to a member granted RUN_SYNC", () => {
    renderSidebar({ canSync: true });
    expect(screen.getByText("Sync banks")).toBeTruthy();
  });

  it("hides Sync banks without RUN_SYNC", () => {
    renderSidebar({ canSync: false });
    expect(screen.queryByText("Sync banks")).toBeNull();
  });

  it("hides Sync banks in demo mode even with RUN_SYNC", () => {
    renderSidebar({ canSync: true, demoMode: true });
    expect(screen.queryByText("Sync banks")).toBeNull();
  });
});
