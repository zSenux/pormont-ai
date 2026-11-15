import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { berlinDateTime, berlinParts, formatDate, todayYmd } from "@/lib/berlin";

export const metadata = { title: "Bautagebuch" };
export const dynamic = "force-dynamic";

// Übersicht: laufende Baustellen mit dem letzten Bautagebuch-Eintrag
export default async function BautagebuchUebersicht() {
  await requireUser();
  const today = todayYmd();
  const projects = await db.project.findMany({
    where: { status: { in: ["LAEUFT", "PLANUNG"] } },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { id: true, name: true, address: true, diary: { orderBy: { day: "desc" }, take: 1, select: { day: true, weather: true } }, _count: { select: { diary: true } } },
  });
  const todayCount = await db.diaryEntry.count({ where: { day: berlinDateTime(today) } });
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Bautagebuch</h1>
        <p className="mt-1 text-sm text-steel">Je Baustelle ein Bautagesbericht pro Tag im Aufbau des Kunden-Formulars: Witterung, Arbeitseinsatz, Geräte, Arbeiten, Änderungen, Vorkommnisse, Fotos – als PDF zum Abgeben. Heute schon {todayCount} {todayCount === 1 ? "Eintrag" : "Einträge"}.</p>
      </div>
      <section className="card divide-y divide-line">
        {projects.length === 0 && <p className="p-5 text-sm text-steel">Keine laufenden Projekte.</p>}
        {projects.map((p) => {
          const last = p.diary[0];
          const done = last && berlinParts(last.day).ymd === today;
          return (
            <Link key={p.id} href={`/projekte/${p.id}/bautagebuch`} className="flex items-center gap-3 p-4 hover:bg-mist/60">
              <BookOpen className={done ? "size-5 text-ok" : "size-5 text-steel"} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-steel">{last ? `Letzter Eintrag ${formatDate(last.day)}${last.weather ? ` · ${last.weather}` : ""} · ${p._count.diary} Tage` : "Noch kein Eintrag"}{p.address && ` · ${p.address}`}</p>
              </div>
              <span className={done ? "chip border-emerald-200 bg-emerald-50 text-ok" : "chip border-brand/20 bg-brand-soft text-brand"}>{done ? "heute erledigt" : "heute eintragen"}</span>
              <ChevronRight className="size-4 text-steel" />
            </Link>
          );
        })}
      </section>
    </main>
  );
}
