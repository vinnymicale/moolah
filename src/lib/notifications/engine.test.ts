import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sendDiscord } from "./discord";
import { runRules } from "./engine";

const evaluate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationRule: { findMany: vi.fn() },
    notification: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("./discord", () => ({ sendDiscord: vi.fn() }));
vi.mock("./triggers", () => ({
  TRIGGER_BY_ID: {
    get: (id: string) =>
      id === "fake-trigger"
        ? {
            id: "fake-trigger",
            modes: ["sweep"],
            severity: "info",
            paramsSchema: { parse: (v: unknown) => v ?? {} },
            defaultTemplate: { title: "Hi {{name}}", body: "Body {{name}}" },
            sampleVars: { name: "Sample" },
            evaluate,
          }
        : undefined,
  },
}));

const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1", userId: "u1", name: "My rule", enabled: true, trigger: "fake-trigger",
  params: "{}", channelId: null, channel: null, templateTitle: null, templateBody: null,
  ...over,
});

const channel = { id: "ch1", userId: "u1", name: "alerts", kind: "discord", webhookUrl: "https://discord.com/api/webhooks/1/t" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.notification.create).mockResolvedValue({ id: "n1" } as never);
});

describe("runRules", () => {
  it("renders the default template, inserts an inbox row, and delivers to the channel", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule({ channelId: "ch1", channel })] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: { name: "World" } }]);
    const summary = await runRules("u1", { mode: "sweep" });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "u1", ruleId: "r1", ruleName: "My rule",
        title: "Hi World", body: "Body World", dedupeKey: "k1",
      },
    });
    expect(sendDiscord).toHaveBeenCalledWith(channel.webhookUrl, { title: "Hi World", body: "Body World", severity: "info" });
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "n1" }, data: { deliveryStatus: "sent" } });
    expect(summary).toEqual({ created: 1, delivered: 1, failed: 0 });
  });

  it("prefers the rule's custom template", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([
      rule({ templateTitle: "Custom {{name}}", templateBody: "B" }),
    ] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: { name: "X" } }]);
    await runRules("u1", { mode: "sweep" });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: "Custom X", body: "B" }) }),
    );
  });

  it("skips silently on a dedupe conflict (P2002)", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule()] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: {} }]);
    vi.mocked(prisma.notification.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const summary = await runRules("u1", { mode: "sweep" });
    expect(summary).toEqual({ created: 0, delivered: 0, failed: 0 });
  });

  it("records delivery failure on the row without throwing", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule({ channelId: "ch1", channel })] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: { name: "W" } }]);
    vi.mocked(sendDiscord).mockRejectedValue(new Error("404 Not Found"));
    const summary = await runRules("u1", { mode: "sweep" });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { deliveryStatus: "failed", deliveryError: "404 Not Found" },
    });
    expect(summary).toEqual({ created: 1, delivered: 0, failed: 1 });
  });

  it("isolates one rule's evaluation error from the others", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule(), rule({ id: "r2", name: "Second" })] as never);
    evaluate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([{ dedupeKey: "k2", vars: { name: "ok" } }]);
    const summary = await runRules("u1", { mode: "sweep" });
    expect(summary.created).toBe(1);
  });

  it("skips rules whose trigger doesn't match the mode", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule()] as never);
    const summary = await runRules("u1", { mode: "event", event: { kind: "plaid-sync", newTransactionIds: [] } });
    expect(evaluate).not.toHaveBeenCalled();
    expect(summary).toEqual({ created: 0, delivered: 0, failed: 0 });
  });

  it("test mode synthesizes a sample event and prefixes the dedupe key", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule({ enabled: false })] as never);
    evaluate.mockResolvedValue([]);
    const summary = await runRules("u1", { mode: "sweep", ruleId: "r1", test: true });
    expect(prisma.notificationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", userId: "u1" } }),
    );
    const data = vi.mocked(prisma.notification.create).mock.calls[0][0].data as { dedupeKey: string; title: string };
    expect(data.dedupeKey.startsWith("test:")).toBe(true);
    expect(data.title).toBe("Hi Sample");
    expect(summary.created).toBe(1);
  });
});
