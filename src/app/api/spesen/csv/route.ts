import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth/user";
import { formatDate } from "@/lib/berlin";
import { csvResponse, deNum } from "@/lib/csv";
import { KIND_LABEL, STATUS_LABEL, type ExpenseKind } from "@/lib/spesen";
import { monthRange, thisMonth } from "@/lib/zeiten";

// Spesen eines Monats als CSV (Administratoren: alle, sonst nur eigene)
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const m = new URL(req.url).searchParams.get("monat") ?? "";
  const month = /^\d{4}-\d{2}$/.test(m) ? m : thisMonth();
  const r = monthRange(month);
  const rows = await db.expense.findMany({
    where: { day: { gte: r.from, lt: r.to }, ...(user.role === "ADMIN" ? {} : { userId: user.id }) },
    orderBy: [{ user: { name: "asc" } }, { day: "asc" }],
    include: { user: { select: { name: true } }, project: { select: { name: true } } },
  });
  return csvResponse(
    `Spesen-${month}.csv`,
    ["Mitarbeiter", "Datum", "Art", "Beschreibung", "Projekt", "km", "Betrag (€)", "Status", "Geprüft von", "Beleg"],
    rows.map((e) => [e.user.name, formatDate(e.day), KIND_LABEL[e.kind as ExpenseKind] ?? e.kind, e.description, e.project?.name ?? "", e.km ?? "", deNum(e.amountCents / 100), STATUS_LABEL[e.status], e.reviewedBy ?? "", e.fileId ? "ja" : "nein"]),
  );
}
