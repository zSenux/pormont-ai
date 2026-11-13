import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { license } from "@/lib/license";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./token";

export type CurrentUser = { id: string; name: string; email: string; role: "ADMIN" | "MEMBER" };

/** Angemeldeter Nutzer oder null (prüft auch die Sitzungs-Version → „überall abmelden“) – ohne Freischaltungs-Prüfung */
export const sessionUser = cache(async (): Promise<CurrentUser | null> => {
  const p = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!p) return null;
  const u = await db.user.findUnique({ where: { id: p.u }, select: { id: true, name: true, email: true, role: true, sessionVersion: true } });
  if (!u || u.sessionVersion !== p.v) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
});

/** Angemeldeter Nutzer – aber nur, solange Klaic Media Jarvis freigeschaltet hat (sonst null → APIs antworten 401) */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const u = await sessionUser();
  if (!u || !(await license()).ok) return null;
  return u;
});

/** Für Seiten und Server-Actions: ohne Anmeldung → /login, ohne Freischaltung → /freischaltung */
export async function requireUser() {
  const u = await sessionUser();
  if (!u) redirect("/login");
  if (!(await license()).ok) redirect("/freischaltung");
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "ADMIN") redirect("/");
  return u;
}

export async function startSession(userId: string, version: number) {
  const token = await signSession({ u: userId, v: version, e: Date.now() + SESSION_DAYS * 86400_000 });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Vorname für die Begrüßung */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
