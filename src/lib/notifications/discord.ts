import type { Severity } from "./types";

const SEVERITY_COLORS: Record<Severity, number> = {
  info: 0x8a8f98,
  warning: 0xe8a33d,
  critical: 0xd64545,
};

export function isValidDiscordWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "discord.com" && host !== "discordapp.com") return false;
  return url.pathname.startsWith("/api/webhooks/");
}

export async function sendDiscord(
  webhookUrl: string,
  message: { title: string; body: string; severity: Severity },
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: message.title,
          description: message.body,
          color: SEVERITY_COLORS[message.severity],
          timestamp: new Date().toISOString(),
          footer: { text: "Moolah" },
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}`);
}
