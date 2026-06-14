"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/demo-guard";
import { encryptSecret } from "@/lib/crypto";
import { generateApiToken, hashApiToken } from "@/lib/api-auth";

export async function updateAiConfigAction(provider: string, apiKey: string) {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  const validProviders = ["anthropic", "openai", "gemini"];
  if (!validProviders.includes(provider)) return { ok: false as const, error: "Invalid provider." };
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      aiProvider: provider,
      // Only update the key if a non-empty value was supplied (allow updating provider without clearing key).
      ...(apiKey.trim() ? { aiApiKey: encryptSecret(apiKey.trim()) } : {}),
    },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function updatePlaidConfigAction(clientId: string, secret: string, env: string) {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  if (!["sandbox", "production"].includes(env)) return { ok: false as const, error: "Invalid environment." };
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      plaidEnv: env,
      ...(clientId.trim() ? { plaidClientId: clientId.trim() } : {}),
      // Only update the secret if a non-empty value was supplied.
      ...(secret.trim() ? { plaidSecret: encryptSecret(secret.trim()) } : {}),
    },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function clearPlaidConfigAction() {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  await prisma.user.update({
    where: { id: session.user.id },
    data: { plaidClientId: null, plaidSecret: null, plaidEnv: null },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function clearAiConfigAction() {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  await prisma.user.update({
    where: { id: session.user.id },
    data: { aiProvider: null, aiApiKey: null },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * Generate (or regenerate) the read-only API token. Returns the raw token once;
 * only its hash is stored. Regenerating invalidates any previous token.
 */
export async function generateApiTokenAction() {
  if (isDemoMode()) return { ok: false as const, error: "Not available in demo mode." };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  const token = generateApiToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { apiTokenHash: hashApiToken(token), apiTokenCreatedAt: new Date() },
  });
  revalidatePath("/settings");
  return { ok: true as const, token };
}

export async function revokeApiTokenAction() {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  await prisma.user.update({
    where: { id: session.user.id },
    data: { apiTokenHash: null, apiTokenCreatedAt: null },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}
