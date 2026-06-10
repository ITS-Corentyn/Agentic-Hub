import { PrismaClient } from '../generated/client/index.js';

export * from '../generated/client/index.js';

/**
 * Client Prisma singleton (évite l'épuisement du pool en dev/hot-reload).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
