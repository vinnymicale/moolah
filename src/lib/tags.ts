import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action-result";

export const DEFAULT_TAG_COLOR = "#64748b";
export const MAX_TAG_NAME_LENGTH = 40;

/** Trim, collapse inner whitespace, enforce the length limit. */
export function normalizeTagName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new UserError("Tag name is required");
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new UserError(`Tag names are limited to ${MAX_TAG_NAME_LENGTH} characters`);
  }
  return name;
}

/**
 * Resolve tag names to ids for one user, matching existing tags
 * case-insensitively and creating any that are missing.
 */
export async function resolveTagIds(userId: string, names: string[]): Promise<string[]> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = normalizeTagName(raw);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(name);
  }
  if (normalized.length === 0) return [];

  const existing = await prisma.tag.findMany({
    where: { userId, name: { in: normalized, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));

  const ids: string[] = [];
  for (const name of normalized) {
    const found = byLower.get(name.toLowerCase());
    if (found) {
      ids.push(found);
      continue;
    }
    const created = await prisma.tag.create({ data: { userId, name }, select: { id: true } });
    ids.push(created.id);
  }
  return ids;
}
