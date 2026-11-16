import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { berlinDateTime, todayYmd } from "@/lib/berlin";
import { customerName, isOverdue, statusText } from "@/lib/buchhaltung/docs";

/** Belegliste wie die Auftragsliste in Lexware faktura+auftrag: alle Belege eines Jahres in einer Tabelle */

export const ARTEN = {
  alle: { kinds: ["ANGEBOT", "RECHNUNG", "GUTSCHRIFT"] as const, label: "Belegliste", status: [["alle", "Alle"], ["offen", "Offen"], ["bezahlt", "Bezahlt"], ["entwurf", "Entwürfe"]] },
  angebote: { kinds: ["ANGEBOT"] as const, label: "Angebote", status: [["alle", "Alle"], ["offen", "Offen"], ["angenommen", "Angenommen"], ["abgelehnt", "Abgelehnt"], ["abgelaufen", "Abgelaufen"], ["entwurf", "Entwürfe"]] },
  rechnungen: { kinds: ["RECHNUNG"] as const, label: "Rechnungen", status: [["alle", "Alle"], ["offen", "Offen"], ["ueberfaellig", "Überfällig"], ["bezahlt", "Bezahlt"], ["entwurf", "Entwürfe"], ["storniert", "Storniert"]] },
  gutschriften: { kinds: ["GUTSCHRIFT"] as const, label: "Gutschriften", status: [["alle", "Alle"]] },
} satisfies Record<string, { kinds: readonly ("ANGEBOT" | "RECHNUNG" | "GUTSCHRIFT")[]; label: string; status: string[][] }>;
export type Art = keyof typeof ARTEN;

export type ListParams = { art?: string; status?: string; q?: string; herkunft?: string; jahr?: string };

export function readParams(sp: ListParams) {
  const art: Art = sp.art && sp.art in ARTEN ? (sp.art as Art) : "rechnungen";
  const conf = ARTEN[art];
  const status = conf.status.find(([k]) => k === sp.status)?.[0] ?? "alle";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const herkunft = sp.herkunft === "lexware" || sp.herkunft === "jarvis" ? sp.herkunft : "alle";
  const thisYear = +todayYmd().slice(0, 4);
  // Jahr wie in Lexware („Jahr 2026“); „alle“ = ohne Jahresgrenze
  const jahr = sp.jahr === "alle" ? "alle" : /^\d{4}$/.test(sp.jahr ?? "") && +sp.jahr! > 1990 && +sp.jahr! <= thisYear + 1 ? sp.jahr! : String(thisYear);
  return { art, conf, status, q, herkunft, jahr };
}

export function whereOf(p: ReturnType<typeof readParams>): Prisma.SalesDocWhereInput {
  const today = berlinDateTime(todayYmd());
  const where: Prisma.SalesDocWhereInput = { kind: { in: [...p.conf.kinds] } };
  const s = p.status;
  if (s === "offen") where.status = "OFFEN";
  if (s === "ueberfaellig" || s === "abgelaufen") Object.assign(where, { status: "OFFEN", dueDate: { lt: today } });
  if (s === "bezahlt") where.status = "BEZAHLT";
  if (s === "entwurf") where.status = "ENTWURF";
  if (s === "storniert") where.status = "STORNIERT";
  if (s === "angenommen") where.status = "ANGENOMMEN";
  if (s === "abgelehnt") where.status = "ABGELEHNT";
  if (p.herkunft !== "alle") where.imported = p.herkunft === "lexware";
  if (p.jahr !== "alle") where.date = { gte: berlinDateTime(`${p.jahr}-01-01`), lt: berlinDateTime(`${+p.jahr + 1}-01-01`) };
  if (p.q) {
    const n = Number(p.q);
    where.OR = [
      { number: { contains: p.q, mode: "insensitive" } },
      { title: { contains: p.q, mode: "insensitive" } },
      { customer: { name: { contains: p.q, mode: "insensitive" } } },
      { project: { name: { contains: p.q, mode: "insensitive" } } },
      ...(Number.isInteger(n) && n > 0 && n < 2 ** 31 ? [{ customer: { number: n } }] : []),
    ];
  }
  return where;
}

/** Kürzel wie in Lexware: AN Angebot, RG Rechnung, AR/SR Abschlags-/Schlussrechnung, ST Storno-Gutschrift, GS Gutschrift */
export function artCode(d: { kind: string; invoiceType: string; sourceId: string | null }) {
  if (d.kind === "ANGEBOT") return { code: "AN", label: "Angebot" };
  if (d.kind === "GUTSCHRIFT") return d.sourceId ? { code: "ST", label: "Storno-Gutschrift" } : { code: "GS", label: "Gutschrift" };
  if (d.invoiceType === "ABSCHLAG") return { code: "AR", label: "Abschlagsrechnung" };
  if (d.invoiceType === "SCHLUSS") return { code: "SR", label: "Schlussrechnung" };
  return { code: "RG", label: "Rechnung" };
}

export const LIST_LIMIT = 2000;

export async function loadList(p: ReturnType<typeof readParams>) {
  const where = whereOf(p);
  const today = berlinDateTime(todayYmd());
  const [docs, count, oldest] = await Promise.all([
    db.salesDoc.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }, { createdAt: "desc" }],
      take: LIST_LIMIT,
      select: {
        id: true, kind: true, status: true, number: true, date: true, dueDate: true, title: true, address: true, imported: true, invoiceType: true, sourceId: true,
        grossCents: true, prepaidCents: true, paidCents: true, sentAt: true,
        customer: { select: { name: true, number: true } }, project: { select: { name: true } },
      },
    }),
    db.salesDoc.count({ where }),
    db.salesDoc.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  // PDF vorhanden? (Bytes nicht mitladen)
  const withPdf = new Set((await db.salesDoc.findMany({ where: { id: { in: docs.map((d) => d.id) }, pdf: { not: null } }, select: { id: true } })).map((d) => d.id));
  const rows = docs.map((d) => {
    const sign = d.kind === "GUTSCHRIFT" ? -1 : 1;
    const expired = d.kind === "ANGEBOT" && d.status === "OFFEN" && !!d.dueDate && d.dueDate < today;
    const overdue = isOverdue(d);
    const a = artCode(d);
    return {
      id: d.id,
      kind: d.kind,
      status: d.status,
      date: d.date.toISOString(),
      art: a.code,
      artLabel: a.label,
      number: d.number,
      note: d.title || d.project?.name || "",
      statusText: expired ? "abgelaufen" : statusText(d),
      tone: overdue ? "UEBERFAELLIG" : expired ? "ABGELEHNT" : d.status,
      paid: d.status === "BEZAHLT",
      sent: !!d.sentAt,
      customerNo: d.customer?.number ?? null,
      customer: customerName(d),
      gross: sign * d.grossCents,
      prepaid: sign * d.prepaidCents,
      claim: sign * (d.grossCents - d.prepaidCents),
      open: d.kind === "RECHNUNG" && d.status === "OFFEN" ? d.grossCents - d.prepaidCents - d.paidCents : 0,
      imported: d.imported,
      hasPdf: d.status === "ENTWURF" || withPdf.has(d.id),
      hasXml: d.kind !== "ANGEBOT" && d.status !== "ENTWURF" && !d.imported && !!d.number,
    };
  });
  const firstYear = oldest ? +oldest.date.toISOString().slice(0, 4) : +todayYmd().slice(0, 4);
  return { rows, count, firstYear };
}

export type ListRow = Awaited<ReturnType<typeof loadList>>["rows"][number];
