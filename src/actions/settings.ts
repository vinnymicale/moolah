"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getHouseholdContext } from "@/lib/household";
import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { encryptSecret } from "@/lib/crypto";
import { generateApiToken, parseApiToken, hashApiTokenVerifier } from "@/lib/api-auth";
import { isAiProvider } from "@/lib/ai-models";
import { recordAudit } from "@/lib/audit";

/**
 * Credentials (Plaid, AI, API token) belong to the household, so only an admin
 * may read or change them. Returns the household id, or an error result the
 * action can hand straight back to the form.
 */
async function requireCredentialAdmin() {
  const { userId } = await requireUser();
  const ctx = await getHouseholdContext(userId);
  if (!ctx) return { ok: false as const, error: "You don't belong to a household." };
  if (!ctx.isAdmin) return { ok: false as const, error: "Only a household admin can change this." };
  return { householdId: ctx.householdId, userId };
}

export async function updateAiConfigAction(provider: string, apiKey: string, model?: string) {
  if (isDemoMode()) return { ok: true as const };
  const admin = await requireCredentialAdmin();
  if ("error" in admin) return admin;
  if (!isAiProvider(provider)) return { ok: false as const, error: "Invalid provider." };
  await prisma.household.update({
    where: { id: admin.householdId },
    data: {
      aiProvider: provider,
      // Only update the key if a non-empty value was supplied (allow updating provider without clearing key).
      ...(apiKey.trim() ? { aiApiKey: encryptSecret(apiKey.trim()) } : {}),
      // Empty means "use the provider default", so it is stored as null rather
      // than pinning whatever the box happened to show.
      aiModel: model?.trim() || null,
    },
  });
  await recordAudit({
    householdId: admin.householdId,
    actorId: admin.userId,
    action: "credential.ai.update",
    entityType: "Household",
    entityId: admin.householdId,
    summary: "AI provider settings updated",
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function updatePlaidConfigAction(clientId: string, secret: string, env: string) {
  if (isDemoMode()) return { ok: true as const };
  const admin = await requireCredentialAdmin();
  if ("error" in admin) return admin;
  if (!["sandbox", "production"].includes(env)) return { ok: false as const, error: "Invalid environment." };
  await prisma.household.update({
    where: { id: admin.householdId },
    data: {
      plaidEnv: env,
      ...(clientId.trim() ? { plaidClientId: clientId.trim() } : {}),
      // Only update the secret if a non-empty value was supplied.
      ...(secret.trim() ? { plaidSecret: encryptSecret(secret.trim()) } : {}),
    },
  });
  await recordAudit({
    householdId: admin.householdId,
    actorId: admin.userId,
    action: "credential.plaid.update",
    entityType: "Household",
    entityId: admin.householdId,
    summary: "Plaid credentials updated",
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function clearPlaidConfigAction() {
  if (isDemoMode()) return { ok: true as const };
  const admin = await requireCredentialAdmin();
  if ("error" in admin) return admin;
  await prisma.household.update({
    where: { id: admin.householdId },
    data: { plaidClientId: null, plaidSecret: null, plaidEnv: null },
  });
  await recordAudit({
    householdId: admin.householdId,
    actorId: admin.userId,
    action: "credential.plaid.clear",
    entityType: "Household",
    entityId: admin.householdId,
    summary: "Plaid credentials cleared",
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function clearAiConfigAction() {
  if (isDemoMode()) return { ok: true as const };
  const admin = await requireCredentialAdmin();
  if ("error" in admin) return admin;
  await prisma.household.update({
    where: { id: admin.householdId },
    data: { aiProvider: null, aiApiKey: null, aiModel: null },
  });
  await recordAudit({
    householdId: admin.householdId,
    actorId: admin.userId,
    action: "credential.ai.clear",
    entityType: "Household",
    entityId: admin.householdId,
    summary: "AI credentials cleared",
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * Generate (or regenerate) the read-only API token. Returns the raw token once;
 * only its selector and a slow hash of its verifier are stored. Regenerating
 * invalidates any previous token.
 */
export async function generateApiTokenAction() {
  if (isDemoMode()) return { ok: false as const, error: "Not available in demo mode." };
  const admin = await requireCredentialAdmin();
  if ("error" in admin) return admin;
  const token = generateApiToken();
  const parsed = parseApiToken(token);
  if (!parsed) return { ok: false as const, error: "Failed to generate token." };
  await prisma.household.update({
    where: { id: admin.householdId },
    data: {
      apiTokenSelector: parsed.selector,
      apiTokenVerifierHash: hashApiTokenVerifier(parsed.verifier),
      apiTokenCreatedAt: new Date(),
    },
  });
  await recordAudit({
    householdId: admin.householdId,
    actorId: admin.userId,
    action: "credential.apiToken.generate",
    entityType: "Household",
    entityId: admin.householdId,
    summary: "API token generated",
  });
  revalidatePath("/settings");
  return { ok: true as const, token };
}

export async function revokeApiTokenAction() {
  if (isDemoMode()) return { ok: true as const };
  const admin = await requireCredentialAdmin();
  if ("error" in admin) return admin;
  await prisma.household.update({
    where: { id: admin.householdId },
    data: { apiTokenSelector: null, apiTokenVerifierHash: null, apiTokenCreatedAt: null },
  });
  await recordAudit({
    householdId: admin.householdId,
    actorId: admin.userId,
    action: "credential.apiToken.revoke",
    entityType: "Household",
    entityId: admin.householdId,
    summary: "API token revoked",
  });
  revalidatePath("/settings");
  return { ok: true as const };
}
