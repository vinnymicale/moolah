"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createHouseholdForUser, joinHouseholdByCode } from "@/lib/household";

export async function createHouseholdAction(name: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  try {
    await createHouseholdForUser(session.user.id, name);
    revalidatePath("/");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function joinHouseholdAction(code: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  try {
    await joinHouseholdByCode(session.user.id, code);
    revalidatePath("/");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function updateHouseholdNameAction(name: string) {
  const session = await auth();
  if (!session?.user?.householdId) return { ok: false as const, error: "No household." };
  await prisma.household.update({
    where: { id: session.user.householdId },
    data: { name: name.trim() || "Our Household" },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function updateAiConfigAction(provider: string, apiKey: string) {
  const session = await auth();
  if (!session?.user?.householdId) return { ok: false as const, error: "No household." };
  const validProviders = ["anthropic", "openai", "gemini"];
  if (!validProviders.includes(provider)) return { ok: false as const, error: "Invalid provider." };
  await prisma.household.update({
    where: { id: session.user.householdId },
    data: {
      aiProvider: provider,
      // Only update the key if a non-empty value was supplied (allow updating provider without clearing key).
      ...(apiKey.trim() ? { aiApiKey: apiKey.trim() } : {}),
    },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function clearAiConfigAction() {
  const session = await auth();
  if (!session?.user?.householdId) return { ok: false as const, error: "No household." };
  await prisma.household.update({
    where: { id: session.user.householdId },
    data: { aiProvider: null, aiApiKey: null },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}

/** Leave the current household (data stays; user is detached). */
export async function leaveHouseholdAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };
  await prisma.user.update({ where: { id: session.user.id }, data: { householdId: null } });
  revalidatePath("/");
  return { ok: true as const };
}
