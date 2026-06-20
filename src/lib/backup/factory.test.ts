// Tests for destinationFor / parseCredentials: routing each destination string
// to the right BackupDestination, decrypting the stored credentials blob, and
// the error paths (unknown destination, gdrive without valid credentials,
// dropbox not yet available). crypto is stubbed so we don't need a real key.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/crypto", () => ({
  // Mirrors the action-side stub: "enc(...)" wraps the plaintext JSON.
  decryptSecret: (s: string) => (s.startsWith("enc(") ? s.slice(4, -1) : s),
}));

import { destinationFor, parseCredentials } from "./factory";
import { LocalDestination } from "./local";
import { GDriveDestination } from "./gdrive";

function gdriveCreds() {
  return JSON.stringify({
    clientId: "cid",
    clientSecret: "csecret",
    refreshToken: "rt",
    folderId: "f1",
  });
}

describe("parseCredentials", () => {
  it("returns an empty object when there are no credentials", () => {
    expect(parseCredentials({ destination: "local", credentials: null })).toEqual({});
  });

  it("decrypts and parses a stored blob", () => {
    const creds = parseCredentials({ destination: "gdrive", credentials: `enc(${gdriveCreds()})` });
    expect(creds.clientId).toBe("cid");
    expect(creds.folderId).toBe("f1");
  });
});

describe("destinationFor", () => {
  it("builds a LocalDestination for local", () => {
    const dest = destinationFor({ destination: "local", credentials: null });
    expect(dest).toBeInstanceOf(LocalDestination);
  });

  it("builds a GDriveDestination when credentials are valid", () => {
    const dest = destinationFor({ destination: "gdrive", credentials: `enc(${gdriveCreds()})` });
    expect(dest).toBeInstanceOf(GDriveDestination);
  });

  it("throws for gdrive without credentials", () => {
    expect(() => destinationFor({ destination: "gdrive", credentials: null })).toThrow(
      /Google Drive isn't connected/,
    );
  });

  it("throws for gdrive with incomplete credentials", () => {
    const partial = `enc(${JSON.stringify({ clientId: "cid" })})`;
    expect(() => destinationFor({ destination: "gdrive", credentials: partial })).toThrow(
      /Google Drive isn't connected/,
    );
  });

  it("reports dropbox as not yet available", () => {
    expect(() => destinationFor({ destination: "dropbox", credentials: null })).toThrow(
      /isn't available yet/,
    );
  });

  it("throws for an unknown destination", () => {
    expect(() => destinationFor({ destination: "s3", credentials: null })).toThrow(
      /Unknown backup destination/,
    );
  });
});
