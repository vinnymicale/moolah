/**
 * @vitest-environment jsdom
 */

// The toast queue exists because a second toast used to evict the first, taking
// an un-clicked Undo with it. The stacking, the overflow eviction and the
// per-toast timers are the parts that regress silently, since a broken timer
// just leaves a toast on screen forever.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast, type ToastOptions } from "./Toast";

/** Exposes toast() to the test through a button per queued message. */
function Harness({ toasts }: { toasts: ToastOptions[] }) {
  const { toast } = useToast();
  return (
    <>
      {toasts.map((t, i) => (
        <button key={i} onClick={() => toast(t)}>
          fire {i}
        </button>
      ))}
    </>
  );
}

function setup(toasts: ToastOptions[]) {
  render(
    <ToastProvider>
      <Harness toasts={toasts} />
    </ToastProvider>,
  );
  // fireEvent rather than user-event: these tests run on fake timers, and
  // user-event's own scheduling never settles against them.
  return {
    fire: (i: number) => fireEvent.click(screen.getByRole("button", { name: `fire ${i}` })),
    click: (name: string) => fireEvent.click(screen.getByRole("button", { name })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows a message and dismisses it after the default delay", () => {
    const { fire } = setup([{ message: "Saved" }]);
    fire(0);
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("honours a custom duration", () => {
    const { fire } = setup([{ message: "Quick", durationMs: 1000 }]);
    fire(0);

    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByText("Quick")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText("Quick")).not.toBeInTheDocument();
  });

  it("stacks toasts instead of replacing them", () => {
    const { fire } = setup([{ message: "First" }, { message: "Second" }]);
    fire(0);
    fire(1);

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("drops the oldest once more than three are on screen", () => {
    const { fire } = setup([
      { message: "One" }, { message: "Two" }, { message: "Three" }, { message: "Four" },
    ]);
    for (const i of [0, 1, 2, 3]) fire(i);

    expect(screen.queryByText("One")).not.toBeInTheDocument();
    for (const m of ["Two", "Three", "Four"]) {
      expect(screen.getByText(m)).toBeInTheDocument();
    }
  });

  it("gives each toast its own timer rather than one shared deadline", () => {
    const { fire } = setup([
      { message: "Early", durationMs: 1000 },
      { message: "Late", durationMs: 5000 },
    ]);
    fire(0);
    fire(1);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText("Early")).not.toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
  });

  it("runs the action and dismisses the toast when it is clicked", () => {
    const onClick = vi.fn();
    const { fire, click } = setup([{ message: "Deleted", action: { label: "Undo", onClick } }]);
    fire(0);

    click("Undo");
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
  });

  it("dismisses on the close button without running the action", () => {
    const onClick = vi.fn();
    const { fire, click } = setup([{ message: "Deleted", action: { label: "Undo", onClick } }]);
    fire(0);

    click("Dismiss");
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
  });

  it("announces a danger toast assertively and the rest politely", () => {
    const { fire } = setup([{ message: "Plain" }, { message: "Boom", tone: "danger" }]);
    fire(0);
    fire(1);

    expect(screen.getByRole("status")).toHaveTextContent("Plain");
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
  });

  it("throws when useToast is called outside the provider", () => {
    function Orphan() {
      useToast();
      return null;
    }
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/must be used within a ToastProvider/);
    quiet.mockRestore();
  });
});
