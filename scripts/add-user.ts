// Benutzer anlegen bzw. Passwort zurücksetzen:
//   pnpm user:add <email> "<Name>" <passwort> [ADMIN|MEMBER]
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const [email, name, password, role = "MEMBER"] = process.argv.slice(2);
if (!email || !name || !password || password.length < 10 || !["ADMIN", "MEMBER"].includes(role)) {
  console.error('Aufruf: pnpm user:add <email> "<Name>" <passwort (mind. 10 Zeichen)> [ADMIN|MEMBER]');
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const passwordHash = await hashPassword(password);
const u = await db.user.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), name, role: role as "ADMIN" | "MEMBER", passwordHash },
  update: { name, role: role as "ADMIN" | "MEMBER", passwordHash, sessionVersion: { increment: 1 } },
});
console.log(`OK: ${u.name} <${u.email}> (${u.role})`);
await db.$disconnect();
