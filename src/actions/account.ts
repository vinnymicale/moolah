"use server";

// Things an account does to itself. Nothing here is household-scoped or
// capability-gated: every signed-in user may change their own password, and
// none of it reaches anyone else's row.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";

const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(8, "New password must be at least 8 characters"),
});

export type ChangePasswordInput = z.input<typeof passwordSchema>;

export async function changePasswordAction(input: ChangePasswordInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const data = passwordSchema.parse(input);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) throw new UserError("This account has no password set.");
    if (!(await compare(data.current, user.passwordHash))) {
      throw new UserError("That is not your current password.");
    }

    await prisma.user.update({
      where: { id: userId },
      // Clearing the flag is what lets a member created by an admin past the
      // gate in the app layout.
      data: { passwordHash: await hash(data.next, 12), mustChangePassword: false },
    });
    revalidatePath("/settings");
  });
}
