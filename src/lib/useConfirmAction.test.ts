import { describe, it, expect } from "vitest";
import { nextConfirmStep } from "./useConfirmAction";

describe("nextConfirmStep", () => {
  it("arms on the first click when not yet armed", () => {
    expect(nextConfirmStep(false)).toBe("arm");
  });

  it("runs the action on the second click once armed", () => {
    expect(nextConfirmStep(true)).toBe("run");
  });

  it("requires two clicks to run: arm then run", () => {
    // Mirrors the hook's sequence: start disarmed, click arms, click runs.
    let armed = false;
    const first = nextConfirmStep(armed);
    expect(first).toBe("arm");
    armed = first === "arm";
    expect(nextConfirmStep(armed)).toBe("run");
  });
});
