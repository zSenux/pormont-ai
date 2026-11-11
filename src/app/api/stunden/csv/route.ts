import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/user";
import { berlinParts, formatDate } from "@/lib/berlin";
import { csvResponse, deNum } from "@/lib/csv";
import { monthRange, thisMonth, TIME_KIND_LABEL, type TimeKind } from "@/lib/zeiten";

// Arbeitszeiten eines Monats als CSV (Administratoren: alle, sonst nur eigene)
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const m = new URL(req.url).searchParams.get("monat") ?? "";
  const month = /^\d{4}-\d{2}$/.test(m) ? m : thisMonth();
  const r = monthRange(month);
  // Laufende Stempelungen (Kommen ohne Gehen) fehlen bewusst
  const all = await db.timeEntry.findMany({
    where: { day: { gte: r.from, lt: r.to }, OR: [{ startAt: null }, { endAt: { not: null } }], ...(user.role === "ADMIN" ? {} : { userId: user.id }) },
    orderBy: [{ user: { name: "asc" } }, { day: "asc" }, { startAt: "asc" }],
    include: { user: { select: { name: true } }, project: { select: { name: true } } },
  });
  const t = (d: Date | null) => (d ? `${String(berlinParts(d).h).padStart(2, "0")}:${String(berlinParts(d).min).padStart(2, "0")}` : "");
  return csvResponse(
    `Arbeitszeit-${month}.csv`,
    ["Mitarbeiter", "Datum", "Art", "Von", "Bis", "Pause (min)", "Stunden", "Projekt", "Notiz"],
    all.map((e) => [e.user.name, formatDate(e.day), TIME_KIND_LABEL[e.kind as TimeKind] ?? e.kind, t(e.startAt), t(e.endAt), e.pauseMin || "", deNum(e.minutes / 60), e.project?.name ?? "", e.note ?? ""]),
  );
}
