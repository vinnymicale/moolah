import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { authorizeLocalUser } from "@/lib/local-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      id: "local-login",
      name: "Sign In",
      credentials: {
        name: { label: "Name", type: "text" },
        password: { label: "Password", type: "password" },
        confirm: { label: "Confirm password", type: "password" },
      },
      async authorize(credentials) {
        return authorizeLocalUser(
          String(credentials?.name || ""),
          String(credentials?.password || ""),
          !!credentials?.confirm,
        );
      },
    }),
  ],
  callbacks: {
    async signIn() {
      return true;
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
});
