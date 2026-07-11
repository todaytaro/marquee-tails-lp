import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7: the client takes either a driver adapter (direct Postgres) or an
// accelerateUrl (prisma+postgres:// — used by `npx prisma dev` local DB and
// Prisma Postgres). Pick by URL scheme so both dev and prod just work.
function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

  if (url.startsWith("prisma+postgres://")) {
    return new PrismaClient({ accelerateUrl: url });
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
}

// Standard Next.js singleton: avoid exhausting connections on dev hot-reload.
// Lazy via Proxy so importing this module never throws at build time
// (next build imports route modules to collect page data without a DB).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof PrismaClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
