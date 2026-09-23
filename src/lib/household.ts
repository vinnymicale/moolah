import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, requireUser } from "@/lib/session";
import { ForbiddenError } from "@/lib/forbidden";
import {
  resolveCapabilities,
  type Capability,
  type HouseholdRoleName,
} from "@/lib/capabilities";

// Re-exported so callers keep importing it from the household module, where
// the checks that throw it live.
export { ForbiddenError } from "@/lib/forbidden";

export interface HouseholdContext {
  /** Who is asking. Notification rows and channels belong to this user. */
  userId: string;
  /** The ledger to query. Everything financial is scoped to this id. */
  householdId: string;
  role: HouseholdRoleName;
  /** OWNER or ADMIN. Gates settings, credentials and membership. */
  isAdmin: boolean;
  can(capability: Capability): boolean;
}

/**
 * Resolve the caller's household and effective capabilities. Returns null when
 * the user belongs to no household, which the caller decides how to handle -
 * a page redirects, an action throws.
 *
 * Capabilities are resolved per request rather than baked into the session
 * token, so an admin revoking access takes effect on the next page load
 * instead of whenever the JWT happens to expire.
 */
export async function getHouseholdContext(userId: string): Promise<HouseholdContext | null> {
  const membership = await prisma.householdMember.findUnique({
    where: { userId },
    select: { householdId: true, role: true, capabilities: true, deniedCapabilities: true },
  });
  if (!membership) return null;

  const role = membership.role as HouseholdRoleName;
  const caps = resolveCapabilities(role, membership.capabilities, membership.deniedCapabilities);
  return {
    userId,
    householdId: membership.householdId,
    role,
    isAdmin: role === "OWNER" || role === "ADMIN",
    can: (capability) => caps.has(capability),
  };
}

/**
 * The page-level entry point: a signed-in user with a household, or a redirect.
 * A user without a membership lands on /no-household rather than seeing an
 * empty ledger that looks like data loss.
 */
export async function requireHousehold(): Promise<HouseholdContext> {
  const { userId } = await requireUser();
  const ctx = await getHouseholdContext(userId);
  if (!ctx) redirect("/no-household");
  return ctx;
}

export function checkCapability(ctx: HouseholdContext, capability: Capability): void {
  if (!ctx.can(capability)) {
    throw new ForbiddenError(`This account is not allowed to ${capability}.`);
  }
}

export function checkAdmin(ctx: HouseholdContext): void {
  if (!ctx.isAdmin) {
    throw new ForbiddenError("Only a household admin can do that.");
  }
}

/**
 * The server-action entry point: resolve the household and check a capability in
 * one call. Actions use this rather than requireHousehold + checkCapability so
 * there is no half-done version where the context was fetched and the check
 * forgotten.
 */
export async function requireCapability(capability: Capability): Promise<HouseholdContext> {
  const ctx = await requireHousehold();
  checkCapability(ctx, capability);
  return ctx;
}

/** As requireCapability, for the admin-only actions: settings, credentials, backups. */
export async function requireAdmin(): Promise<HouseholdContext> {
  const ctx = await requireHousehold();
  checkAdmin(ctx);
  return ctx;
}

/**
 * Page-level gate. A member who lacks a page's capability is sent to the
 * dashboard rather than shown a 403 - they should land somewhere useful, not at
 * a wall. Without VIEW_DASHBOARD either, they get the no-access screen.
 */
export async function requirePageCapability(capability: Capability): Promise<HouseholdContext> {
  const ctx = await requireHousehold();
  if (ctx.can(capability)) return ctx;
  redirect(capability === "VIEW_DASHBOARD" || !ctx.can("VIEW_DASHBOARD") ? "/no-access" : "/");
}

/** Page-level admin gate. Non-admins land on /no-access rather than a blank settings form. */
export async function requirePageAdmin(): Promise<HouseholdContext> {
  const ctx = await requireHousehold();
  if (!ctx.isAdmin) redirect("/no-access");
  return ctx;
}

/**
 * The route-handler entry point. Unlike requireHousehold, API routes must answer
 * with JSON rather than redirect, so this returns either the context or the
 * response to send back.
 */
export async function householdForRoute(): Promise<
  { ctx: HouseholdContext; response?: undefined } | { ctx?: undefined; response: Response }
> {
  const session = await getSession();
  if (!session?.user?.id) {
    return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const ctx = await getHouseholdContext(session.user.id);
  if (!ctx) {
    return { response: Response.json({ error: "No household" }, { status: 403 }) };
  }
  return { ctx };
}
