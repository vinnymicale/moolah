import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCategories } from "@/lib/user-setup";

/**
 * Dev login lets you sign in locally without Google OAuth credentials. It is
 * enabled when AUTH_DEV_LOGIN=true or AUTH_BYPASS=true (bypass always needs it).
 */
const allowDevLogin = process.env.AUTH_DEV_LOGIN === "true" || process.env.AUTH_BYPASS === "true";

/** Optional allow-list so only you can sign in. */
function isAllowedEmail(email: string | null | undefined): boolean {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return true; // no allow-list configured => anyone may sign in
  const allowed = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT sessions so Google and the dev-login Credentials provider can coexist.
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/signin" },
  providers: [
    // Only register Google when credentials are configured, so the sign-in
    // button is never shown in a broken state.
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(allowDevLogin
      ? [
          Credentials({
            id: "dev-login",
            name: "Dev Login",
            credentials: { email: { label: "Email", type: "email" } },
            async authorize(credentials) {
              const email = String(credentials?.email || "demo@example.com").toLowerCase();
              // When bypass is on the auto-signin route always uses the local
              // user email - let it through regardless of the allow-list.
              const isBypassUser =
                process.env.AUTH_BYPASS === "true" &&
                email === (process.env.LOCAL_USER_EMAIL?.trim() || "local@moolah.local").toLowerCase();
              if (!isBypassUser && !isAllowedEmail(email)) return null;
              let user = await prisma.user.findUnique({ where: { email } });
              if (!user) {
                user = await prisma.user.create({
                  data: { email, name: email.split("@")[0] },
                });
                await ensureDefaultCategories(user.id);
              }
              return { id: user.id, email: user.email, name: user.name, image: user.image };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user }) {
      const isBypassUser =
        process.env.AUTH_BYPASS === "true" &&
        user.email?.toLowerCase() === (process.env.LOCAL_USER_EMAIL?.trim() || "local@moolah.local").toLowerCase();
      return isBypassUser || isAllowedEmail(user.email);
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string | undefined) ?? "";
      }
      return session;
    },
  },
  events: {
    // Seed the default categories for users created by the Prisma adapter
    // (Google sign-in); dev login and auto-signin seed on their own create paths.
    async createUser({ user }) {
      if (user.id) await ensureDefaultCategories(user.id);
    },
  },
});
