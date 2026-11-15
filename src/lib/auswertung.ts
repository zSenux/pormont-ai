import "server-only";
import { db } from "@/lib/db";
import { berlinDateTime } from "@/lib/berlin";
import { customerName } from "@/lib/buchhaltung/docs";
import { lineNetCents, readLines } from "@/lib/buchhaltung/money";
import { calcProject } from "@/lib/nachkalkulation";

// Jahresauswertung: profitabelste Kunden, Produkte (Produktgruppen aus den Projekten + Rechnungspositionen)
// und Monteure. Quellen: festgeschriebene Rechnungen/Gutschriften (netto, Schlussrechnungen nur mit dem Rest),
// Nachkalkulation je Projekt (Auftragswert − Kosten = Deckungsbeitrag) und gebuchte Stunden.

/** Produktgruppen im Metallbau – Zuordnung über Stichworte in Projektname/Beschreibung bzw. Position */
export const PRODUCT_GROUPS: [string, RegExp][] = [
  ["Treppen", /treppe|stufe|wendel/i],
  ["Geländer & Handläufe", /geländer|gelaender|handlauf|balkon|brüstung/i],
  ["Tore, Türen & Zäune", /\btor\b|tore\b|schiebetor|tür|tuer|zaun|zarge|t30|t90/i],
  ["Vordächer & Carports", /vordach|überdachung|carport|dach/i],
  ["Stahlbau", /stahlbau|halle|hea|heb|ipe|stütze|träger|bühne|podest/i],
  ["Rohrleitungsbau & Industrie", /rohrleitung|industrie|anlage|montage/i],
  ["Reparatur & Wartung", /reparatur|wartung|instandsetz|service/i],
];
export const groupOf = (text: string) => PRODUCT_GROUPS.find(([, re]) => re.test(text))?.[0] ?? "Sonstiges";

type Agg = { revenue: number; cost: number; margin: number; projects: number; hours: number };
const empty = (): Agg => ({ revenue: 0, cost: 0, margin: 0, projects: 0, hours: 0 });

export async function yearReport(year: number) {
  const from = berlinDateTime(`${year}-01-01`), to = berlinDateTime(`${year + 1}-01-01`);
  const docs = await db.salesDoc.findMany({
    where: { kind: { in: ["RECHNUNG", "GUTSCHRIFT"] }, status: { not: "ENTWURF" }, date: { gte: from, lt: to } },
    select: { id: true, kind: true, status: true, invoiceType: true, date: true, netCents: true, prepaidNet: true, lines: true, address: true, customerId: true, projectId: true, customer: { select: { id: true, name: true } } },
  });

  // Umsatz je Kunde und Monat (wie in der Buchhaltung: Schluss nur Rest, Gutschriften abziehen)
  const months = Array.from({ length: 12 }, () => 0);
  const byCustomer = new Map<string, { id: string | null; name: string; revenue: number; invoices: number; margin: number; marginBase: number; projects: Set<string> }>();
  for (const d of docs) {
    const sign = d.kind === "GUTSCHRIFT" ? -1 : 1;
    const net = (sign * (d.netCents - d.prepaidNet)) / 100;
    months[d.date.getUTCMonth()] += net;
    const key = d.customerId ?? `name:${customerName(d)}`;
    const c = byCustomer.get(key) ?? { id: d.customerId, name: customerName(d), revenue: 0, invoices: 0, margin: 0, marginBase: 0, projects: new Set<string>() };
    c.revenue += net;
    if (d.kind === "RECHNUNG") c.invoices++;
    if (d.projectId) c.projects.add(d.projectId);
    byCustomer.set(key, c);
  }

  // Positionen → Artikel/Leistungen (ohne Abschläge: die Schlussrechnung enthält die volle Leistung)
  const byItem = new Map<string, { name: string; group: string; revenue: number; qty: number; unit: string; count: number }>();
  for (const d of docs) {
    if (d.invoiceType === "ABSCHLAG") continue;
    const sign = d.kind === "GUTSCHRIFT" ? -1 : 1;
    for (const l of readLines(d.lines)) {
      // Abschlags-Positionen sind keine Produkte (die Leistung steht in der Schlussrechnung)
      if (/^abschlag/i.test(l.name.trim())) continue;
      const key = (l.articleId ?? l.name.toLowerCase().replace(/\s+/g, " ").slice(0, 80)).trim();
      const it = byItem.get(key) ?? { name: l.name, group: groupOf(`${l.name} ${l.description ?? ""}`), revenue: 0, qty: 0, unit: l.unit, count: 0 };
      it.revenue += (sign * lineNetCents(l)) / 100;
      it.qty += sign * l.qty;
      it.count++;
      byItem.set(key, it);
    }
  }

  // Projekte des Jahres: mit Rechnung im Jahr oder Stunden im Jahr → Nachkalkulation
  const timeProjects = await db.timeEntry.findMany({ where: { day: { gte: from, lt: to }, projectId: { not: null } }, distinct: ["projectId"], select: { projectId: true } });
  const projectIds = [...new Set([...docs.map((d) => d.projectId), ...timeProjects.map((t) => t.projectId)].filter(Boolean) as string[])];
  const calcs = [];
  for (const id of projectIds) calcs.push(await calcProject(id));
  const byGroup = new Map<string, Agg>();
  for (const c of calcs) {
    const g = groupOf(`${c.project.name} ${c.project.description ?? ""}`);
    const a = byGroup.get(g) ?? empty();
    a.projects++;
    a.hours += c.minutes / 60;
    a.cost += c.total;
    if (c.revenue) {
      a.revenue += c.revenue;
      a.margin += c.margin ?? 0;
    }
    byGroup.set(g, a);
    // Deckungsbeitrag dem Kunden zuordnen
    if (c.revenue && c.project.customerId) {
      const cust = byCustomer.get(c.project.customerId);
      if (cust) (cust.margin += c.margin ?? 0), (cust.marginBase += c.revenue);
    }
  }

  // Monteure: Stunden im Jahr, Anteil auf Projekten, anteiliger Auftragswert/DB nach Stundenanteil je Projekt
  const times = await db.timeEntry.findMany({ where: { day: { gte: from, lt: to }, kind: { in: ["ARBEIT", "FAHRT"] } }, select: { userId: true, projectId: true, minutes: true } });
  const users = await db.user.findMany({ select: { id: true, name: true } });
  const projectMinutes = new Map<string, number>();
  for (const c of calcs) projectMinutes.set(c.project.id, c.minutes);
  const calcById = new Map(calcs.map((c) => [c.project.id, c]));
  const people = new Map<string, { id: string; name: string; hours: number; projectHours: number; revenue: number; margin: number; jobsDone: number; planH: number; actualH: number; assemblies: number }>();
  for (const u of users) people.set(u.id, { id: u.id, name: u.name, hours: 0, projectHours: 0, revenue: 0, margin: 0, jobsDone: 0, planH: 0, actualH: 0, assemblies: 0 });
  for (const t of times) {
    const p = people.get(t.userId);
    if (!p) continue;
    p.hours += t.minutes / 60;
    if (!t.projectId) continue;
    p.projectHours += t.minutes / 60;
    const c = calcById.get(t.projectId);
    const total = projectMinutes.get(t.projectId) ?? 0;
    if (c?.revenue && total > 0) {
      p.revenue += (c.revenue * t.minutes) / total;
      p.margin += ((c.margin ?? 0) * t.minutes) / total;
    }
  }
  const [jobs, crews] = await Promise.all([
    db.productionJob.findMany({ where: { doneAt: { gte: from, lt: to }, assigneeId: { not: null } }, select: { assigneeId: true, plannedHours: true, actualHours: true } }),
    db.assemblyMember.findMany({ where: { assembly: { startAt: { gte: from, lt: to }, status: { in: ["ERLEDIGT", "ABGENOMMEN"] } } }, select: { userId: true } }),
  ]);
  for (const j of jobs) {
    const p = people.get(j.assigneeId!);
    if (!p) continue;
    p.jobsDone++;
    if (j.plannedHours && j.actualHours) (p.planH += j.plannedHours), (p.actualH += j.actualHours);
  }
  for (const c of crews) {
    const p = people.get(c.userId);
    if (p) p.assemblies++;
  }

  const customers = [...byCustomer.values()].map((c) => ({ ...c, projects: c.projects.size, marginPct: c.marginBase ? (c.margin / c.marginBase) * 100 : null })).sort((a, b) => b.revenue - a.revenue);
  const items = [...byItem.values()].sort((a, b) => b.revenue - a.revenue);
  const groups = [...byGroup.entries()].map(([name, a]) => ({ name, ...a, marginPct: a.revenue ? (a.margin / a.revenue) * 100 : null, perHour: a.hours ? a.margin / a.hours : null })).sort((a, b) => b.margin - a.margin);
  const team = [...people.values()].filter((p) => p.hours > 0).map((p) => ({ ...p, productive: p.hours ? (p.projectHours / p.hours) * 100 : 0, perHour: p.projectHours ? p.margin / p.projectHours : null, planAccuracy: p.planH ? (p.actualH / p.planH) * 100 : null })).sort((a, b) => b.margin - a.margin);
  const revenue = months.reduce((a, b) => a + b, 0);
  const margin = calcs.reduce((t, c) => t + (c.revenue ? (c.margin ?? 0) : 0), 0);
  const marginBase = calcs.reduce((t, c) => t + (c.revenue ?? 0), 0);
  return { year, revenue, months, invoices: docs.filter((d) => d.kind === "RECHNUNG").length, customers, items, groups, team, projects: calcs.length, margin, marginPct: marginBase ? (margin / marginBase) * 100 : null };
}

const eur = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v)} %`);

/** Kurztext für Jarvis (Monteure nur mit full) */
export function reportText(r: Awaited<ReturnType<typeof yearReport>>, full: boolean, top = 5) {
  const out = [`Jahresauswertung ${r.year}: Umsatz ${eur(r.revenue)} netto aus ${r.invoices} Rechnungen; ${r.projects} Projekte nachkalkuliert, Deckungsbeitrag ${eur(r.margin)} (${pct(r.marginPct)}).`];
  out.push("\nKunden (Umsatz, DB):", ...r.customers.slice(0, top).map((c, i) => `${i + 1}. ${c.name}: ${eur(c.revenue)}${c.marginPct !== null ? `, DB ${eur(c.margin)} (${pct(c.marginPct)})` : ""}`));
  out.push("\nProduktgruppen nach Deckungsbeitrag:", ...r.groups.slice(0, top).map((g, i) => `${i + 1}. ${g.name}: DB ${eur(g.margin)} (${pct(g.marginPct)}) aus ${g.projects} ${g.projects === 1 ? "Projekt" : "Projekten"}${g.perHour !== null ? `, ${eur(g.perHour)} je Stunde` : ""}`));
  out.push("\nUmsatzstärkste Positionen:", ...r.items.slice(0, top).map((x, i) => `${i + 1}. ${x.name}: ${eur(x.revenue)}`));
  if (full) out.push("\nMonteure (DB-Anteil nach Stunden):", ...r.team.slice(0, top + 3).map((p, i) => `${i + 1}. ${p.name}: ${Math.round(p.hours)} Std. (${pct(p.productive)} auf Projekten), DB-Anteil ${eur(p.margin)}${p.perHour !== null ? ` = ${eur(p.perHour)}/Std.` : ""}${p.planAccuracy !== null ? `, Ist/Plan Fertigung ${pct(p.planAccuracy)}` : ""}`));
  out.push(`[Jahresauswertung](/auswertung?jahr=${r.year})`);
  return out.join("\n");
}
