// Action-layer tests for settings.ts. These cover the demo-mode and admin
// guards, provider/env validation, the "only overwrite secrets when a new
// value was typed" behavior, and the API-token lifecycle - by stubbing the
// side-effecting imports (prisma, session, household, crypto, api-auth, cache).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/session", () => ({ requireUser: async () => ({ userId: "u1" }) }));

const householdMock = vi.fn();
vi.mock("@/lib/household", () => ({ getHouseholdContext: () => householdMock() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/crypto", () => ({
  encryptSecret: (value: string) => `enc(${value})`,
}));

const apiAuth = {
  generateApiToken: vi.fn(),
  parseApiToken: vi.fn(),
  hashApiTokenVerifier: vi.fn(),
};
vi.mock("@/lib/api-auth", () => ({
  generateApiToken: () => apiAuth.generateApiToken(),
  parseApiToken: (token: string) => apiAuth.parseApiToken(token),
  hashApiTokenVerifier: (verifier: string) => apiAuth.hashApiTokenVerifier(verifier),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    household: {
      update: vi.fn(),
    },
  },
}));

import {
  updateAiConfigAction,
  updatePlaidConfigAction,
  clearPlaidConfigAction,
  clearAiConfigAction,
  generateApiTokenAction,
  revokeApiTokenAction,
} from "./settings";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const household = vi.mocked(prisma.household);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  householdMock.mockResolvedValue({ userId: "u1", householdId: "h1", isAdmin: true });
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("config actions are no-op successes in demo mode", async () => {
    expect(await updateAiConfigAction("anthropic", "key")).toEqual({ ok: true });
    expect(await updatePlaidConfigAction("id", "secret", "sandbox")).toEqual({ ok: true });
    expect(await clearPlaidConfigAction()).toEqual({ ok: true });
    expect(await clearAiConfigAction()).toEqual({ ok: true });
    expect(await revokeApiTokenAction()).toEqual({ ok: true });
    expect(household.update).not.toHaveBeenCalled();
  });

  it("generateApiTokenAction refuses in demo mode", async () => {
    const result = await generateApiTokenAction();
    expect(result).toEqual({ ok: false, error: "Not available in demo mode." });
    expect(household.update).not.toHaveBeenCalled();
  });
});

describe("household guard", () => {
  beforeEach(() => {
    householdMock.mockResolvedValue(null);
  });

  it("every action errors when the user has no household", async () => {
    const expected = { ok: false, error: "You don't belong to a household." };
    expect(await updateAiConfigAction("anthropic", "key")).toEqual(expected);
    expect(await updatePlaidConfigAction("id", "secret", "sandbox")).toEqual(expected);
    expect(await clearPlaidConfigAction()).toEqual(expected);
    expect(await clearAiConfigAction()).toEqual(expected);
    expect(await generateApiTokenAction()).toEqual(expected);
    expect(await revokeApiTokenAction()).toEqual(expected);
    expect(household.update).not.toHaveBeenCalled();
  });

  it("every action errors for a member who isn't an admin", async () => {
    householdMock.mockResolvedValue({ userId: "u2", householdId: "h1", isAdmin: false });
    const expected = { ok: false, error: "Only a household admin can change this." };
    expect(await updateAiConfigAction("anthropic", "key")).toEqual(expected);
    expect(await updatePlaidConfigAction("id", "secret", "sandbox")).toEqual(expected);
    expect(await clearPlaidConfigAction()).toEqual(expected);
    expect(await clearAiConfigAction()).toEqual(expected);
    expect(await generateApiTokenAction()).toEqual(expected);
    expect(await revokeApiTokenAction()).toEqual(expected);
    expect(household.update).not.toHaveBeenCalled();
  });
});

describe("updateAiConfigAction", () => {
  it("stores the provider and the encrypted key", async () => {
    const result = await updateAiConfigAction("anthropic", " sk-123 ");
    expect(result).toEqual({ ok: true });
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { aiProvider: "anthropic", aiApiKey: "enc(sk-123)", aiModel: null },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("leaves the stored key untouched when the key field is blank", async () => {
    await updateAiConfigAction("openai", "   ");
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { aiProvider: "openai", aiModel: null },
    });
  });

  it("stores a model override when one is given", async () => {
    await updateAiConfigAction("gemini", "", " gemini-3.5-flash-lite ");
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { aiProvider: "gemini", aiModel: "gemini-3.5-flash-lite" },
    });
  });

  it("clears the model override when the field is blank", async () => {
    await updateAiConfigAction("gemini", "", "   ");
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { aiProvider: "gemini", aiModel: null },
    });
  });

  it("rejects an unknown provider", async () => {
    const result = await updateAiConfigAction("skynet", "key");
    expect(result).toEqual({ ok: false, error: "Invalid provider." });
    expect(household.update).not.toHaveBeenCalled();
  });
});

describe("updatePlaidConfigAction", () => {
  it("stores env, client id, and the encrypted secret", async () => {
    const result = await updatePlaidConfigAction(" client ", " shh ", "production");
    expect(result).toEqual({ ok: true });
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { plaidEnv: "production", plaidClientId: "client", plaidSecret: "enc(shh)" },
    });
  });

  it("leaves stored credentials untouched when the fields are blank", async () => {
    await updatePlaidConfigAction("  ", "  ", "sandbox");
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { plaidEnv: "sandbox" },
    });
  });

  it("rejects an unknown environment", async () => {
    const result = await updatePlaidConfigAction("client", "shh", "development");
    expect(result).toEqual({ ok: false, error: "Invalid environment." });
    expect(household.update).not.toHaveBeenCalled();
  });
});

describe("clear actions", () => {
  it("clearPlaidConfigAction nulls out all Plaid fields", async () => {
    const result = await clearPlaidConfigAction();
    expect(result).toEqual({ ok: true });
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { plaidClientId: null, plaidSecret: null, plaidEnv: null },
    });
  });

  it("clearAiConfigAction nulls out the AI fields", async () => {
    const result = await clearAiConfigAction();
    expect(result).toEqual({ ok: true });
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { aiProvider: null, aiApiKey: null, aiModel: null },
    });
  });
});

describe("generateApiTokenAction", () => {
  beforeEach(() => {
    apiAuth.generateApiToken.mockReturnValue("moolah_sel_ver");
    apiAuth.parseApiToken.mockReturnValue({ selector: "sel", verifier: "ver" });
    apiAuth.hashApiTokenVerifier.mockReturnValue("hash(ver)");
  });

  it("returns the raw token once and stores only selector + verifier hash", async () => {
    const result = await generateApiTokenAction();
    expect(result).toEqual({ ok: true, token: "moolah_sel_ver" });
    expect(apiAuth.hashApiTokenVerifier).toHaveBeenCalledWith("ver");
    const args = household.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "h1" });
    expect(args.data.apiTokenSelector).toBe("sel");
    expect(args.data.apiTokenVerifierHash).toBe("hash(ver)");
    expect(args.data.apiTokenCreatedAt).toBeInstanceOf(Date);
    // The raw token must never be persisted.
    expect(JSON.stringify(args.data)).not.toContain("moolah_sel_ver");
  });

  it("errors when the generated token cannot be parsed", async () => {
    apiAuth.parseApiToken.mockReturnValue(null);
    const result = await generateApiTokenAction();
    expect(result).toEqual({ ok: false, error: "Failed to generate token." });
    expect(household.update).not.toHaveBeenCalled();
  });
});

describe("revokeApiTokenAction", () => {
  it("nulls out all token fields", async () => {
    const result = await revokeApiTokenAction();
    expect(result).toEqual({ ok: true });
    expect(household.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { apiTokenSelector: null, apiTokenVerifierHash: null, apiTokenCreatedAt: null },
    });
  });
});
