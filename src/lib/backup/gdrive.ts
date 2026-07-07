// Google Drive backup destination. Uploads each backup as a file inside a chosen
// Drive folder, lists/prunes by filename. Auth uses the OAuth "installed app"
// refresh-token flow: the user creates a Google Cloud OAuth client, grants the
// Drive scope once, and pastes the resulting refresh token plus the client
// id/secret into Settings. We exchange that refresh token for a short-lived
// access token per run - no browser round-trip needed at backup time.
//
// Drive identifies files by an opaque id, not by name, and happily allows
// duplicate names in a folder. We always look files up by name within the
// configured folder, so list()/delete() work off the same filename the rest of
// the backup system uses (see BackupDestination).

import { type BackupDestination, type StoredBackup, isBackupName } from "./destination";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

export interface GDriveCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  // The Drive folder id backups live in. Required: a folder keeps backups out of
  // the user's Drive root and lets retention prune only this app's files.
  folderId: string;
}

export function isGDriveCredentials(c: unknown): c is GDriveCredentials {
  if (!c || typeof c !== "object") return false;
  const v = c as Record<string, unknown>;
  return (
    typeof v.clientId === "string" &&
    typeof v.clientSecret === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.folderId === "string" &&
    v.clientId !== "" &&
    v.clientSecret !== "" &&
    v.refreshToken !== "" &&
    v.folderId !== ""
  );
}

async function accessToken(creds: GDriveCredentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await safeText(res);
    // invalid_grant means the refresh token itself is dead (revoked, or expired
    // after 7 days because the OAuth consent screen is still in "Testing").
    // Retrying can't fix that, so point the user at the actual remedy.
    if (detail.includes("invalid_grant")) {
      throw new Error(
        "Google Drive refresh token has expired or been revoked. Generate a new refresh token and paste it in Settings. " +
          "If this keeps happening, your OAuth consent screen is in \"Testing\" mode, which expires tokens after 7 days - publish it to Production to get long-lived tokens.",
      );
    }
    throw new Error(`Google token exchange failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token response had no access_token.");
  return json.access_token;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

// `name = 'x' and 'folder' in parents and trashed = false`, with name single-
// quote-escaped per Drive query syntax.
function nameQuery(name: string, folderId: string): string {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `name = '${escaped}' and '${folderId}' in parents and trashed = false`;
}

export class GDriveDestination implements BackupDestination {
  constructor(private readonly creds: GDriveCredentials) {}

  async put(name: string, data: Buffer): Promise<void> {
    const token = await accessToken(this.creds);
    const boundary = `moolah-${Date.now()}`;
    const metadata = JSON.stringify({ name, parents: [this.creds.folderId] });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Google Drive upload failed (${res.status}): ${await safeText(res)}`);
    }
  }

  async list(): Promise<StoredBackup[]> {
    const token = await accessToken(this.creds);
    const out: StoredBackup[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${this.creds.folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(name)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`${FILES_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Google Drive list failed (${res.status}): ${await safeText(res)}`);
      }
      const json = (await res.json()) as {
        files?: { name: string }[];
        nextPageToken?: string;
      };
      for (const f of json.files ?? []) {
        if (isBackupName(f.name)) out.push({ name: f.name });
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
    return out;
  }

  async delete(name: string): Promise<void> {
    const token = await accessToken(this.creds);
    // Resolve name -> id within the folder, then delete by id.
    const params = new URLSearchParams({
      q: nameQuery(name, this.creds.folderId),
      fields: "files(id)",
      pageSize: "10",
    });
    const lookup = await fetch(`${FILES_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!lookup.ok) {
      throw new Error(`Google Drive lookup failed (${lookup.status}): ${await safeText(lookup)}`);
    }
    const json = (await lookup.json()) as { files?: { id: string }[] };
    for (const file of json.files ?? []) {
      const res = await fetch(`${FILES_URL}/${file.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      // 404 means it's already gone - fine for a delete.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Google Drive delete failed (${res.status}): ${await safeText(res)}`);
      }
    }
  }
}
