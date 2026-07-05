// Alert delivery. Two channels:
//  - ntfy: POST the plain-text body to the topic URL with a Title header,
//    which is all an ntfy topic needs (https://docs.ntfy.sh/publish/).
//  - webhook: POST a small JSON payload, for Home Assistant / n8n / anything
//    that accepts a generic webhook.

export type AlertKind = "ntfy" | "webhook";

export function isValidAlertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function sendAlert(
  kind: AlertKind,
  url: string,
  message: { title: string; body: string },
): Promise<void> {
  const init: RequestInit =
    kind === "ntfy"
      ? {
          method: "POST",
          headers: { Title: message.title, Tags: "moneybag" },
          body: message.body,
        }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "moolah", title: message.title, body: message.body }),
        };

  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Alert delivery failed: ${res.status} ${res.statusText}`);
  }
}
