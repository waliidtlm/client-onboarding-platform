import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnvironment } from "@/lib/env";

type PrismaGlobal = typeof globalThis & {
  prismaClient?: PrismaClient;
};

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    }),
  });
}

const prismaGlobal = globalThis as PrismaGlobal;

export const prisma =
  prismaGlobal.prismaClient ?? createPrismaClient(getServerEnvironment().DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.prismaClient = prisma;
}

export async function checkDatabaseConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
