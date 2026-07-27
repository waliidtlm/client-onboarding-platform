import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";

import { prisma } from "@/lib/database";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { logger } from "@/lib/logger";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

export async function authorizeStaff(input: Record<"email" | "password", unknown> | undefined) {
  const credentials = credentialsSchema.safeParse(input);

  if (!credentials.success) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: credentials.data.email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    await hashPassword(credentials.data.password);
    return null;
  }

  const passwordMatches = await verifyPassword(user.passwordHash, credentials.data.password);

  if (!passwordMatches || !user.isActive) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export const authOptions: NextAuthOptions = {
  // Startup validation rejects a missing runtime secret. The fallback allows `next build`
  // to compile without turning the build environment into an authentication environment.
  secret: process.env.AUTH_SECRET ?? "build-only-auth-secret-not-valid-at-runtime",
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers: [
    CredentialsProvider({
      name: "Staff credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeStaff,
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.staffId = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.staffId && token.role) {
        session.user.id = token.staffId;
        session.user.role = token.role;
      }
      return session;
    },
  },
  logger: {
    error(code) {
      logger.error(
        { action: "authentication", errorCode: code },
        "Authentication provider reported an error",
      );
    },
    warn(code) {
      logger.warn(
        { action: "authentication", errorCode: code },
        "Authentication provider reported a warning",
      );
    },
  },
};
