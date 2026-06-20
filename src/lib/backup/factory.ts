// Maps a stored BackupConfig to a concrete BackupDestination, decrypting any
// credentials blob on the way. Keeping this in one place means runScheduledBackup
// stays destination-agnostic and new providers slot in here.

import { decryptSecret } from "@/lib/crypto";
import type { BackupDestination } from "./destination";
import { LocalDestination } from "./local";
import { GDriveDestination, isGDriveCredentials } from "./gdrive";

export interface BackupConfigLike {
  destination: string;
  credentials: string | null;
}

// Parsed, decrypted credentials. Local needs none; cloud providers carry their
// OAuth client id/secret, a refresh token, and a target folder. Shape grows as
// providers land.
export interface BackupCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  folderId?: string;
  folderPath?: string;
}

export function parseCredentials(config: BackupConfigLike): BackupCredentials {
  if (!config.credentials) return {};
  return JSON.parse(decryptSecret(config.credentials)) as BackupCredentials;
}

export function destinationFor(config: BackupConfigLike): BackupDestination {
  switch (config.destination) {
    case "local":
      return new LocalDestination();
    case "gdrive": {
      const creds = parseCredentials(config);
      if (!isGDriveCredentials(creds)) {
        throw new Error(
          "Google Drive isn't connected. Add your OAuth client id/secret, a refresh token, and a folder id in Settings.",
        );
      }
      return new GDriveDestination(creds);
    }
    case "dropbox":
      throw new Error(
        `The "${config.destination}" backup destination isn't available yet. Use "local" for now.`,
      );
    default:
      throw new Error(`Unknown backup destination "${config.destination}".`);
  }
}
