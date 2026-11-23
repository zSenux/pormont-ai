import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Ein PrismaClient pro Prozess (verhindert zu viele Verbindungen beim Hot-Reload)
function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL ist nicht gesetzt.");
  // Verbindungs-Pool mit Grenzen: ohne connectionTimeout warten Anfragen bei vollem Pool ewig –
  // der Server wirkt dann „abgestürzt“, obwohl der Prozess noch läuft. Jetzt gibt es nach 15 s einen Fehler.
  const adapter = new PrismaPg(
    {
      connectionString,
      max: Number(process.env.DB_POOL_MAX) || 10,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    },
    {
      // Abgebrochene Verbindungen (Datenbank-Neustart, Netz) nur melden – der Pool baut neu auf
      onPoolError: (e) => console.warn("[db] Verbindung im Pool abgebrochen:", e.message),
      onConnectionError: (e) => console.warn("[db] Verbindung abgebrochen:", e.message),
    },
  );
  return new PrismaClient({ adapter });
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
