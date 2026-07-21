// Action-layer tests for notifications.ts. These cover the guards that wrap
// the DB writes - the demo-mode short-circuit, ownership/existence checks,
// webhook and trigger-params validation - by stubbing the side-effecting
// imports (prisma, session, cache, the notification engine).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/notifications/discord", () => ({
  isValidDiscordWebhookUrl: (url: string) => url.startsWith("https://discord.com/api/webhooks/"),
}));

vi.mock("@/lib/notifications/triggers", () => ({
  TRIGGER_BY_ID: new Map([
    [
      "low-balance",
      { paramsSchema: z.object({ threshold: z.number().positive("Threshold must be positive.") }) },
    ],
  ]),
}));

const runRulesMock = vi.fn();
vi.mock("@/lib/notifications/engine", () => ({
  runRules: (...args: unknown[]) => runRulesMock(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationChannel: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    notificationRule: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    notification: {
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import {
  saveChannelAction,
  deleteChannelAction,
  saveRuleAction,
  setRuleEnabledAction,
  deleteRuleAction,
  testRuleAction,
  markReadAction,
  deleteNotificationAction,
} from "./notifications";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

const requireUserMock = vi.mocked(requireUser);
const channel = vi.mocked(prisma.notificationChannel);
const rule = vi.mocked(prisma.notificationRule);
const notification = vi.mocked(prisma.notification);

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

const validRuleInput = {
  name: "Low balance",
  trigger: "low-balance",
  params: JSON.stringify({ threshold: 100 }),
  channelId: null,
  templateTitle: null,
  templateBody: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("every action is a no-op success in demo mode", async () => {
    expect(await saveChannelAction({ name: "c", webhookUrl: WEBHOOK })).toEqual({ ok: true });
    expect(await deleteChannelAction("c1")).toEqual({ ok: true });
    expect(await saveRuleAction(validRuleInput)).toEqual({ ok: true });
    expect(await setRuleEnabledAction("r1", false)).toEqual({ ok: true });
    expect(await deleteRuleAction("r1")).toEqual({ ok: true });
    expect(await testRuleAction("r1")).toEqual({ ok: true });
    expect(await markReadAction("all")).toEqual({ ok: true });
    expect(await deleteNotificationAction("n1")).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(channel.create).not.toHaveBeenCalled();
    expect(rule.create).not.toHaveBeenCalled();
    expect(notification.updateMany).not.toHaveBeenCalled();
    expect(notification.deleteMany).not.toHaveBeenCalled();
  });
});

describe("saveChannelAction", () => {
  it("creates a discord channel scoped to the user", async () => {
    const result = await saveChannelAction({ name: " Alerts ", webhookUrl: WEBHOOK });
    expect(result).toEqual({ ok: true });
    expect(channel.create).toHaveBeenCalledWith({
      data: { userId: "u1", name: "Alerts", kind: "discord", webhookUrl: WEBHOOK },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/notifications");
  });

  it("rejects an empty name", async () => {
    const result = await saveChannelAction({ name: "  ", webhookUrl: WEBHOOK });
    expect(result).toEqual({ ok: false, error: "Channel name is required." });
    expect(channel.create).not.toHaveBeenCalled();
  });

  it("rejects a non-Discord webhook URL", async () => {
    const result = await saveChannelAction({ name: "Alerts", webhookUrl: "https://evil.example/hook" });
    expect(result.ok).toBe(false);
    expect(channel.create).not.toHaveBeenCalled();
  });

  it("updates an existing channel the user owns", async () => {
    channel.findFirst.mockResolvedValue({ id: "c1" } as never);
    const result = await saveChannelAction({ id: "c1", name: "Alerts", webhookUrl: WEBHOOK });
    expect(result).toEqual({ ok: true });
    expect(channel.findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" } });
    expect(channel.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Alerts", webhookUrl: WEBHOOK },
    });
    expect(channel.create).not.toHaveBeenCalled();
  });

  it("errors when updating a channel the user does not own", async () => {
    channel.findFirst.mockResolvedValue(null);
    const result = await saveChannelAction({ id: "c1", name: "Alerts", webhookUrl: WEBHOOK });
    expect(result).toEqual({ ok: false, error: "Channel not found." });
    expect(channel.update).not.toHaveBeenCalled();
  });
});

describe("deleteChannelAction", () => {
  it("deletes a channel the user owns", async () => {
    channel.findFirst.mockResolvedValue({ id: "c1" } as never);
    const result = await deleteChannelAction("c1");
    expect(result).toEqual({ ok: true });
    expect(channel.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("errors when the channel does not belong to the user", async () => {
    channel.findFirst.mockResolvedValue(null);
    const result = await deleteChannelAction("c1");
    expect(result).toEqual({ ok: false, error: "Channel not found." });
    expect(channel.delete).not.toHaveBeenCalled();
  });
});

describe("saveRuleAction", () => {
  it("creates a rule with validated, re-serialized params", async () => {
    const result = await saveRuleAction(validRuleInput);
    expect(result).toEqual({ ok: true });
    expect(rule.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        name: "Low balance",
        trigger: "low-balance",
        params: JSON.stringify({ threshold: 100 }),
        channelId: null,
        templateTitle: null,
        templateBody: null,
      },
    });
  });

  it("rejects an empty name", async () => {
    const result = await saveRuleAction({ ...validRuleInput, name: " " });
    expect(result).toEqual({ ok: false, error: "Rule name is required." });
  });

  it("rejects an unknown trigger", async () => {
    const result = await saveRuleAction({ ...validRuleInput, trigger: "nope" });
    expect(result).toEqual({ ok: false, error: "Unknown trigger." });
  });

  it("rejects params that are not valid JSON", async () => {
    const result = await saveRuleAction({ ...validRuleInput, params: "{oops" });
    expect(result).toEqual({ ok: false, error: "Invalid rule parameters." });
  });

  it("surfaces the schema's message when params fail validation", async () => {
    const result = await saveRuleAction({
      ...validRuleInput,
      params: JSON.stringify({ threshold: -5 }),
    });
    expect(result).toEqual({ ok: false, error: "Threshold must be positive." });
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("errors when the referenced channel does not belong to the user", async () => {
    channel.findFirst.mockResolvedValue(null);
    const result = await saveRuleAction({ ...validRuleInput, channelId: "c1" });
    expect(result).toEqual({ ok: false, error: "Channel not found." });
    expect(channel.findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" } });
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("trims templates and stores blanks as null", async () => {
    await saveRuleAction({ ...validRuleInput, templateTitle: "  Hi  ", templateBody: "   " });
    const data = rule.create.mock.calls[0][0].data;
    expect(data.templateTitle).toBe("Hi");
    expect(data.templateBody).toBeNull();
  });

  it("updates an existing rule the user owns", async () => {
    rule.findFirst.mockResolvedValue({ id: "r1" } as never);
    const result = await saveRuleAction({ ...validRuleInput, id: "r1" });
    expect(result).toEqual({ ok: true });
    expect(rule.findFirst).toHaveBeenCalledWith({ where: { id: "r1", userId: "u1" } });
    expect(rule.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({ name: "Low balance" }),
    });
    expect(rule.create).not.toHaveBeenCalled();
  });

  it("errors when updating a rule the user does not own", async () => {
    rule.findFirst.mockResolvedValue(null);
    const result = await saveRuleAction({ ...validRuleInput, id: "r1" });
    expect(result).toEqual({ ok: false, error: "Rule not found." });
    expect(rule.update).not.toHaveBeenCalled();
  });
});

describe("setRuleEnabledAction", () => {
  it("toggles a rule the user owns", async () => {
    rule.findFirst.mockResolvedValue({ id: "r1" } as never);
    const result = await setRuleEnabledAction("r1", false);
    expect(result).toEqual({ ok: true });
    expect(rule.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { enabled: false } });
  });

  it("errors when the rule does not belong to the user", async () => {
    rule.findFirst.mockResolvedValue(null);
    const result = await setRuleEnabledAction("r1", true);
    expect(result).toEqual({ ok: false, error: "Rule not found." });
    expect(rule.update).not.toHaveBeenCalled();
  });
});

describe("deleteRuleAction", () => {
  it("deletes a rule the user owns", async () => {
    rule.findFirst.mockResolvedValue({ id: "r1" } as never);
    const result = await deleteRuleAction("r1");
    expect(result).toEqual({ ok: true });
    expect(rule.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });

  it("errors when the rule does not belong to the user", async () => {
    rule.findFirst.mockResolvedValue(null);
    const result = await deleteRuleAction("r1");
    expect(result).toEqual({ ok: false, error: "Rule not found." });
    expect(rule.delete).not.toHaveBeenCalled();
  });
});

describe("testRuleAction", () => {
  beforeEach(() => {
    rule.findFirst.mockResolvedValue({ id: "r1" } as never);
  });

  it("runs the engine in single-rule test mode", async () => {
    runRulesMock.mockResolvedValue({ failed: 0 });
    const result = await testRuleAction("r1");
    expect(result).toEqual({ ok: true });
    expect(runRulesMock).toHaveBeenCalledWith("u1", { mode: "sweep", ruleId: "r1", test: true });
  });

  it("errors when delivery fails", async () => {
    runRulesMock.mockResolvedValue({ failed: 1 });
    const result = await testRuleAction("r1");
    expect(result.ok).toBe(false);
  });

  it("errors when the rule does not belong to the user", async () => {
    rule.findFirst.mockResolvedValue(null);
    const result = await testRuleAction("r1");
    expect(result).toEqual({ ok: false, error: "Rule not found." });
    expect(runRulesMock).not.toHaveBeenCalled();
  });
});

describe("markReadAction", () => {
  it("marks specific unread notifications as read, scoped to the user", async () => {
    const result = await markReadAction(["n1", "n2"]);
    expect(result).toEqual({ ok: true });
    const args = notification.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u1", id: { in: ["n1", "n2"] }, readAt: null });
    expect(args.data.readAt).toBeInstanceOf(Date);
  });

  it("marks all unread notifications as read", async () => {
    await markReadAction("all");
    const args = notification.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u1", readAt: null });
  });

  it("refreshes the whole layout so the sidebar badge updates", async () => {
    await markReadAction("all");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("deleteNotificationAction", () => {
  it("deletes the caller's notification scoped to the user", async () => {
    notification.deleteMany.mockResolvedValue({ count: 1 } as never);
    const result = await deleteNotificationAction("n1");
    expect(result).toEqual({ ok: true });
    expect(notification.deleteMany).toHaveBeenCalledWith({ where: { id: "n1", userId: "u1" } });
  });

  it("is a no-op success when the id belongs to another user", async () => {
    notification.deleteMany.mockResolvedValue({ count: 0 } as never);
    const result = await deleteNotificationAction("n1");
    expect(result).toEqual({ ok: true });
    expect(notification.deleteMany).toHaveBeenCalledWith({ where: { id: "n1", userId: "u1" } });
  });

  it("refreshes the whole layout so the sidebar badge updates", async () => {
    notification.deleteMany.mockResolvedValue({ count: 1 } as never);
    await deleteNotificationAction("n1");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
