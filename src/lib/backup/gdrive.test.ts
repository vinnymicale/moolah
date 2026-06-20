// Tests for the Google Drive destination's credential guard and its HTTP
// behaviour against a mocked fetch: token exchange, multipart upload, paged
// listing (filtered to backup names), and name->id delete.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GDriveDestination, isGDriveCredentials } from "./gdrive";

const creds = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rtoken",
  folderId: "folder123",
};

describe("isGDriveCredentials", () => {
  it("accepts a complete credentials object", () => {
    expect(isGDriveCredentials(creds)).toBe(true);
  });

  it("rejects missing or empty fields", () => {
    expect(isGDriveCredentials({ ...creds, folderId: "" })).toBe(false);
    expect(isGDriveCredentials({ clientId: "a", clientSecret: "b", refreshToken: "c" })).toBe(false);
    expect(isGDriveCredentials(null)).toBe(false);
    expect(isGDriveCredentials({})).toBe(false);
  });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("GDriveDestination", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tokenOk() {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at" }));
  }

  it("exchanges the refresh token then uploads with the access token", async () => {
    tokenOk();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "newfile" }));

    const dest = new GDriveDestination(creds);
    await dest.put("moolah-backup-2026-06-20_03-00-00.json", Buffer.from("{}"));

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toContain("oauth2.googleapis.com/token");
    expect(String(tokenInit.body)).toContain("grant_type=refresh_token");

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(String(uploadUrl)).toContain("uploadType=multipart");
    expect(uploadInit.headers.Authorization).toBe("Bearer at");
  });

  it("throws when the token exchange fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad" }, false, 400));
    const dest = new GDriveDestination(creds);
    await expect(dest.put("moolah-backup-2026-06-20_03-00-00.json", Buffer.from("{}"))).rejects.toThrow(
      /token exchange failed/,
    );
  });

  it("lists only backup-named files, following pagination", async () => {
    tokenOk();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        files: [{ name: "moolah-backup-2026-06-19_03-00-00.json" }, { name: "notes.txt" }],
        nextPageToken: "p2",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ files: [{ name: "moolah-backup-2026-06-20_03-00-00.json" }] }),
    );

    const dest = new GDriveDestination(creds);
    const list = await dest.list();
    expect(list.map((f) => f.name)).toEqual([
      "moolah-backup-2026-06-19_03-00-00.json",
      "moolah-backup-2026-06-20_03-00-00.json",
    ]);
  });

  it("resolves a name to an id and deletes it", async () => {
    tokenOk();
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [{ id: "fileABC" }] }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, true, 204));

    const dest = new GDriveDestination(creds);
    await dest.delete("moolah-backup-2026-06-19_03-00-00.json");

    const deleteCall = fetchMock.mock.calls[2];
    expect(String(deleteCall[0])).toContain("/files/fileABC");
    expect(deleteCall[1].method).toBe("DELETE");
  });
});
