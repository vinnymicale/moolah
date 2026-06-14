import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hash } from "bcryptjs";
import { authorizeLocalUser } from "./local-auth";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/user-setup";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/user-setup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/user-setup")>();
  return { ...actual, ensureDefaultCategories: vi.fn() };
});

const findUnique = vi.mocked(prisma.user.findUnique);
const create = vi.mocked(prisma.user.create);
const update = vi.mocked(prisma.user.update);
const seedCategories = vi.mocked(ensureDefaultCategories);

const vinny = {
  id: "u1",
  email: "vinny@moolah.local",
  name: "Vinny",
  image: null,
};

function userRow(passwordHash: string | null) {
  return {
    ...vinny,
    passwordHash,
    emailVerified: null,
    createdAt: new Date(),
    aiProvider: null,
    aiApiKey: null,
    plaidClientId: null,
    plaidSecret: null,
    plaidEnv: null,
    apiTokenSelector: null,
    apiTokenVerifierHash: null,
    apiTokenCreatedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUTH_BYPASS;
  delete process.env.LOCAL_USER_NAME;
});

afterEach(() => {
  delete process.env.AUTH_BYPASS;
  delete process.env.LOCAL_USER_NAME;
});

describe("authorizeLocalUser - sign in", () => {
  it("signs in an existing user with the correct password", async () => {
    findUnique.mockResolvedValue(userRow(await hash("secret123", 4)));
    const result = await authorizeLocalUser("Vinny", "secret123", false);
    expect(result).toEqual(vinny);
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "vinny@moolah.local" } });
  });

  it("is case-insensitive on the name", async () => {
    findUnique.mockResolvedValue(userRow(await hash("secret123", 4)));
    const result = await authorizeLocalUser("  vInNy ", "secret123", false);
    expect(result).toEqual(vinny);
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "vinny@moolah.local" } });
  });

  it("rejects a wrong password", async () => {
    findUnique.mockResolvedValue(userRow(await hash("secret123", 4)));
    expect(await authorizeLocalUser("Vinny", "wrong", false)).toBeNull();
  });

  it("rejects an unknown name", async () => {
    findUnique.mockResolvedValue(null);
    expect(await authorizeLocalUser("Nobody", "secret123", false)).toBeNull();
  });

  it("rejects a user that exists but has no password set", async () => {
    findUnique.mockResolvedValue(userRow(null));
    expect(await authorizeLocalUser("Vinny", "anything", false)).toBeNull();
  });

  it("rejects empty name or password", async () => {
    expect(await authorizeLocalUser("", "secret123", false)).toBeNull();
    expect(await authorizeLocalUser("   ", "secret123", false)).toBeNull();
    expect(await authorizeLocalUser("Vinny", "", false)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("authorizeLocalUser - sign up", () => {
  it("creates a new user with a hashed password and seeds categories", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue(userRow("$2b$..."));
    const result = await authorizeLocalUser("Vinny", "secret123", true);
    expect(result).toEqual(vinny);
    const data = create.mock.calls[0][0].data as { email: string; name: string; passwordHash: string };
    expect(data.email).toBe("vinny@moolah.local");
    expect(data.name).toBe("Vinny");
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(data.passwordHash).not.toBe("secret123");
    expect(seedCategories).toHaveBeenCalledWith("u1");
  });

  it("does not overwrite an existing account that has a password", async () => {
    findUnique.mockResolvedValue(userRow(await hash("original", 4)));
    expect(await authorizeLocalUser("Vinny", "hijack", true)).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("claims a password-less user row instead of duplicating it", async () => {
    findUnique.mockResolvedValue(userRow(null));
    update.mockResolvedValue(userRow("$2b$..."));
    const result = await authorizeLocalUser("Vinny", "newpass", true);
    expect(result).toEqual(vinny);
    expect(update).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("derives the same identity for differently-cased names", async () => {
    findUnique.mockResolvedValue(userRow(await hash("original", 4)));
    expect(await authorizeLocalUser("VINNY", "other", true)).toBeNull();
  });
});

describe("authorizeLocalUser - bypass mode", () => {
  it("signs in the bypass user without a password when AUTH_BYPASS=true", async () => {
    process.env.AUTH_BYPASS = "true";
    process.env.LOCAL_USER_NAME = "Vinny";
    findUnique.mockResolvedValue(userRow(null));
    expect(await authorizeLocalUser("Vinny", "", false)).toEqual(vinny);
  });

  it("creates the bypass user on first sign-in", async () => {
    process.env.AUTH_BYPASS = "true";
    process.env.LOCAL_USER_NAME = "Vinny";
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue(userRow(null));
    expect(await authorizeLocalUser("Vinny", "", false)).toEqual(vinny);
    expect(seedCategories).toHaveBeenCalledWith("u1");
  });

  it("does not let other names skip the password when bypass is on", async () => {
    process.env.AUTH_BYPASS = "true";
    process.env.LOCAL_USER_NAME = "Vinny";
    expect(await authorizeLocalUser("Mallory", "", false)).toBeNull();
  });

  it("requires a password for everyone when bypass is off", async () => {
    process.env.LOCAL_USER_NAME = "Vinny";
    expect(await authorizeLocalUser("Vinny", "", false)).toBeNull();
  });
});
