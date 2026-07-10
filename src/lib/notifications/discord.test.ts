import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidDiscordWebhookUrl, sendDiscord } from "./discord";

describe("isValidDiscordWebhookUrl", () => {
  it("accepts discord.com and discordapp.com webhook URLs", () => {
    expect(isValidDiscordWebhookUrl("https://discord.com/api/webhooks/123/abc")).toBe(true);
    expect(isValidDiscordWebhookUrl("https://discordapp.com/api/webhooks/123/abc")).toBe(true);
  });

  it("rejects http, other hosts, other paths, and garbage", () => {
    expect(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/123/abc")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://evil.com/api/webhooks/123/abc")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://discord.com/channels/123")).toBe(false);
    expect(isValidDiscordWebhookUrl("not a url")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://notdiscord.com/api/webhooks/x")).toBe(false);
  });
});

describe("sendDiscord", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts an embed with title, body, severity color, and Moolah footer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await sendDiscord("https://discord.com/api/webhooks/1/t", {
      title: "Over budget",
      body: "Groceries is $12 over",
      severity: "warning",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/1/t");
    const payload = JSON.parse(init!.body as string);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].title).toBe("Over budget");
    expect(payload.embeds[0].description).toBe("Groceries is $12 over");
    expect(payload.embeds[0].footer).toEqual({ text: "Moolah" });
    expect(typeof payload.embeds[0].color).toBe("number");
    expect(typeof payload.embeds[0].timestamp).toBe("string");
  });

  it("throws on non-2xx with the status in the message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404, statusText: "Not Found" }));
    await expect(
      sendDiscord("https://discord.com/api/webhooks/1/t", { title: "t", body: "b", severity: "info" }),
    ).rejects.toThrow(/404/);
  });
});
