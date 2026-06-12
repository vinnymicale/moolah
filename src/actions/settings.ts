"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/demo-guard";
import { encryptSecret } from "@/lib/crypto";

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
