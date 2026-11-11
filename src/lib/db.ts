import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Ein PrismaClient pro Prozess (verhindert zu viele Verbindungen beim Hot-Reload)
function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL ist nicht gesetzt.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getDb() {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createDb();
  return globalForPrisma.prisma;
}

// Erst beim ersten Zugriff verbinden – so läuft der Build (Seiten-Daten sammeln) auch ohne DATABASE_URL
export const db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const client = getDb();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
