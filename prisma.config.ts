import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL ist beim Build (prisma generate) evtl. noch nicht gesetzt – z. B. wenn in Klaic Deploy
// noch keine Datenbank angelegt ist. generate braucht keine Verbindung, db push/seed schon.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(process.env.DATABASE_URL && { datasource: { url: process.env.DATABASE_URL } }),
});
