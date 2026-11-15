// Demo-Beispieldaten für einen Metallbau-Betrieb (Projekte mit Phasen, Team, Meilensteine, Aufgaben, Lager, Lieferanten).
// NUR für lokale Tests und Vorführungen – niemals gegen die Live-Datenbank:
//   pnpm demo:seed
// Läuft nicht bei NODE_ENV=production und nicht, wenn schon Projekte existieren (außer DEMO_FORCE=1).
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { PHASES } from "../src/lib/phases-shared";
import { createOrderFromQuote } from "../src/lib/orders";
import { requestAbsence } from "../src/lib/abwesenheit";
import { addDaysYmd, berlinDateTime, todayYmd } from "../src/lib/berlin";

if (process.env.NODE_ENV === "production") {
  console.error("Abbruch: Demo-Daten nie in Produktion.");
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
if ((await db.project.count()) > 0 && process.env.DEMO_FORCE !== "1") {
  console.error("Abbruch: Es gibt schon Projekte. Demo-Daten nur in eine leere Datenbank (oder DEMO_FORCE=1).");
  process.exit(1);
}

const DAY = 86400_000;
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// Team (Passwort für alle Demo-Konten: demo-passwort)
const pw = await hashPassword("demo-passwort");
const people = [
  ["dirk.linke@demo.promont", "Dirk Linke", "ADMIN", "GF"],
  ["josip.cabraja@demo.promont", "Josip Cabraja", "ADMIN", "PROJEKTLEITUNG"],
  ["sven.mueller@demo.promont", "Sven Müller", "MEMBER", "FERTIGUNG"],
  ["anna.weber@demo.promont", "Anna Weber", "MEMBER", "VERTRIEB"],
  ["mehmet.yilmaz@demo.promont", "Mehmet Yılmaz", "MEMBER", "MONTAGE"],
  ["tobias.kern@demo.promont", "Tobias Kern", "MEMBER", "FERTIGUNG"],
] as const;
const users: Record<string, string> = {};
for (const [email, name, role, funktion] of people) {
  const u = await db.user.upsert({ where: { email }, create: { email, name, role, funktion, passwordHash: pw }, update: {} });
  users[name] = u.id;
}

type Demo = { name: string; customer: string; address: string; description: string; leader: string; team: [string, string][]; done: number; running?: boolean; start: number; end: number; budget: number; milestones: [string, number, boolean][]; tasks: [string, string, number, string][] };
const projects: Demo[] = [
  { name: "Stahltreppe mit Podest MFH Käfertal", customer: "Wohnbau Rhein-Neckar GmbH", address: "Mannheimer Str. 112, 68309 Mannheim", description: "Gerade Stahltreppe 16 Stufen, Wangen U-Profil 200, Gitterroststufen, Podest 1,2 × 2,4 m, feuerverzinkt", leader: "Josip Cabraja", team: [["Sven Müller", "Werkstatt"], ["Mehmet Yılmaz", "Montage"]], done: 6, running: true, start: -30, end: 18, budget: 28400, milestones: [["Freigabe Werkplanung", -12, true], ["Rückkehr Verzinkerei", 6, false], ["Montage fertig", 15, false]], tasks: [["Schweißnähte Podest prüfen", "Sven Müller", -1, "HOCH"], ["Verzinkung Termin bestätigen", "Anna Weber", 2, "NORMAL"]] },
  { name: "Edelstahl-Geländer Balkone Neckarstadt", customer: "Hausverwaltung Krämer", address: "Lange Rötterstr. 41, 68167 Mannheim", description: "12 Balkongeländer V2A geschliffen K320, Glasfüllung VSG 2×8 mm, Handlauf Ø 42,4", leader: "Dirk Linke", team: [["Tobias Kern", "Werkstatt"], ["Mehmet Yılmaz", "Montage"]], done: 4, running: true, start: -14, end: 35, budget: 41750, milestones: [["Aufmaß abgeschlossen", -5, true], ["Glas bestellt", 3, false]], tasks: [["Glasmaße an Lieferanten", "Anna Weber", -2, "DRINGEND"], ["Konstruktionszeichnung Pfosten", "Josip Cabraja", 4, "HOCH"]] },
  { name: "Hallenvordach Logistikzentrum Ladenburg", customer: "Neckar Logistik AG", address: "Benzstr. 7, 68526 Ladenburg", description: "Vordach 18 × 4 m, HEA 200 / IPE 160, Trapezblech, Entwässerung, Statik durch Büro Hartmann", leader: "Josip Cabraja", team: [["Sven Müller", "Werkstatt"], ["Tobias Kern", "Werkstatt"], ["Mehmet Yılmaz", "Montage"]], done: 2, running: true, start: -7, end: 60, budget: 86200, milestones: [["Statik freigegeben", 5, false], ["Stahl bestellt", 12, false]], tasks: [["Statik bei Hartmann nachfragen", "Josip Cabraja", -3, "HOCH"]] },
  { name: "Schiebetor mit Antrieb Weinheim", customer: "Familie Schneider", address: "Bergstr. 88, 69469 Weinheim", description: "Freitragendes Schiebetor 5,5 m, Füllung Flachstahl senkrecht, Antrieb Sommer, RAL 7016", leader: "Dirk Linke", team: [["Tobias Kern", "Werkstatt"]], done: 1, running: true, start: -3, end: 40, budget: 9800, milestones: [], tasks: [["Angebot nachfassen", "Anna Weber", 1, "NORMAL"]] },
  { name: "Brandschutztüren T30 Schule Feudenheim", customer: "Stadt Mannheim – Fachbereich Bau", address: "Neckarstr. 1, 68259 Mannheim", description: "6 Stahltüren T30-1 inkl. Zarge, Panikschloss, Montage in den Ferien", leader: "Josip Cabraja", team: [["Mehmet Yılmaz", "Montage"]], done: 8, running: true, start: -45, end: 5, budget: 15600, milestones: [["Montage in den Herbstferien", -2, true], ["Abnahme mit Bauamt", 4, false]], tasks: [["Abnahmeprotokoll vorbereiten", "Josip Cabraja", 3, "HOCH"]] },
  { name: "Anfrage: Carport Stahl Viernheim", customer: "Herr Bauer", address: "Rathausstr. 12, 68519 Viernheim", description: "Doppelcarport Stahl, Flachdach, feuerverzinkt + pulverbeschichtet", leader: "Dirk Linke", team: [], done: 0, running: true, start: 0, end: 50, budget: 0, milestones: [], tasks: [["Aufmaß-Termin vereinbaren", "Anna Weber", 2, "NORMAL"]] },
];

for (const d of projects) {
  const p = await db.project.create({
    data: { name: d.name, customer: d.customer, address: d.address, description: d.description, status: d.done === 0 ? "PLANUNG" : "LAEUFT", startDate: day(d.start), endDate: day(d.end), budgetNet: d.budget || null, leaderId: users[d.leader], createdById: users[d.leader] },
  });
  const span = (d.end - d.start) / PHASES.length;
  await db.projectPhase.createMany({
    data: PHASES.map((ph, i) => ({
      projectId: p.id,
      key: ph.key,
      sort: ph.sort,
      status: i < d.done ? "ERLEDIGT" : i === d.done && d.running ? "LAEUFT" : ph.key === "OBERFLAECHE" && d.name.includes("Brandschutz") ? "ENTFAELLT" : "OFFEN",
      startDate: day(Math.round(d.start + i * span)),
      endDate: day(Math.round(d.start + (i + 1) * span)),
      doneAt: i < d.done ? day(Math.round(d.start + (i + 1) * span)) : null,
      doneByName: i < d.done ? d.leader : null,
    })),
  });
  for (const [name, role] of d.team) await db.projectMember.create({ data: { projectId: p.id, userId: users[name], role } });
  for (const [title, off, done] of d.milestones) await db.projectMilestone.create({ data: { projectId: p.id, title, dueDate: day(off), doneAt: done ? day(off) : null } });
  for (const [title, who, off, prio] of d.tasks) await db.task.create({ data: { title, projectId: p.id, assigneeId: users[who], dueAt: day(off), priority: prio, createdById: users[d.leader] } });
  // Stunden der letzten Tage
  for (const [name] of d.team) for (let k = 1; k <= 3; k++) await db.timeEntry.create({ data: { projectId: p.id, userId: users[name], day: day(-k), minutes: 240 + 60 * k, note: "Demo" } });
}

// Wer ist gerade eingestempelt
for (const name of ["Sven Müller", "Tobias Kern", "Mehmet Yılmaz"]) await db.timeEntry.create({ data: { userId: users[name], day: day(0), minutes: 0, startAt: new Date(Date.now() - 3 * 3600_000) } });

// Lieferanten, Lager, Anfragen/Bestellungen
const stahl = await db.supplier.create({ data: { name: "Stahlhandel Rhein-Neckar (Demo)", kind: "STAHL", contactName: "Frau Becker", email: "anfrage@stahlhandel.example", city: "Mannheim" } });
const schrauben = await db.supplier.create({ data: { name: "Würth-Niederlassung (Demo)", kind: "GROSSHANDEL", email: "bestellung@schrauben.example", city: "Ludwigshafen" } });
const verzinkerei = await db.supplier.create({ data: { name: "Verzinkerei Neckartal (Demo)", kind: "VERZINKEREI", email: "dispo@verzinkerei.example", city: "Heidelberg" } });
const items: [string, string, string, string, number, number, number, string][] = [
  ["Flachstahl 50×8", "FLACH_RUND", "S235JR", "m", 84, 60, 6.4, stahl.id],
  ["Rundrohr 42,4×2", "ROHR", "V2A", "m", 18, 30, 14.9, stahl.id],
  ["Vierkantrohr 60×60×4", "ROHR", "S235JR", "m", 46, 40, 11.2, stahl.id],
  ["HEA 200", "PROFIL", "S355J2", "m", 12, 24, 58.0, stahl.id],
  ["Blech 3 mm 2000×1000", "BLECH", "DC01", "Tafel", 9, 6, 72.5, stahl.id],
  ["Sechskantschraube M12×40 8.8 verzinkt", "SCHRAUBEN", "8.8 fvz", "Stk", 140, 200, 0.32, schrauben.id],
  ["Schwerlastanker M12", "SCHRAUBEN", "verzinkt", "Stk", 64, 50, 2.1, schrauben.id],
  ["Schweißdraht SG2 1,0 mm", "VERBRAUCH", "SG2", "Rolle", 3, 4, 38.0, schrauben.id],
  ["Trennscheibe 125 mm Inox", "VERBRAUCH", null as unknown as string, "Stk", 55, 25, 1.4, schrauben.id],
];
for (const [name, category, material, unit, quantity, minQuantity, price, supplierId] of items) {
  await db.stockItem.create({ data: { name, category, material, unit, quantity, minQuantity, reorderQty: minQuantity * 2, price, supplierId, location: category === "SCHRAUBEN" ? "Regal B" : "Lager Halle 1" } });
}
const vordach = await db.project.findFirstOrThrow({ where: { name: { contains: "Hallenvordach" } } });
const treppe = await db.project.findFirstOrThrow({ where: { name: { contains: "Stahltreppe" } } });
await db.supplierRequest.create({ data: { supplierId: stahl.id, projectId: vordach.id, subject: "Preisanfrage HEA 200 / IPE 160 – Vordach Ladenburg", text: "Demo", positions: [{ menge: 8, einheit: "Stk", text: "HEA 200, S355J2, 6.000 mm" }], status: "GESENDET", sentAt: day(-2), dueAt: day(3) } });
await db.supplierRequest.create({ data: { supplierId: verzinkerei.id, projectId: treppe.id, subject: "Feuerverzinkung Treppe Käfertal", text: "Demo", positions: [{ menge: 1, einheit: "psch", text: "Treppe + Podest, ca. 1.850 kg" }], status: "BESTELLT", sentAt: day(-9), offerAmount: 1480 } });
await db.supplierRequest.create({ data: { supplierId: schrauben.id, subject: "Nachbestellung Schrauben M12", text: "Demo", positions: [{ menge: 400, einheit: "Stk", text: "Sechskantschraube M12×40 8.8 fvz" }], status: "ANGEBOT", sentAt: day(-4), offerAmount: 118 } });

// Bestellungen mit Wareneingang
const stockId = async (name: string) => (await db.stockItem.findFirstOrThrow({ where: { name } })).id;
const L = (text: string, qty: number, unit: string, price: number, stockItemId: string | null = null, received = 0) => ({ text, qty, unit, price, stockItemId, received });
const orders = [
  { number: "BE-DEMO-001", supplierId: stahl.id, projectId: vordach.id, status: "BESTELLT", orderedAt: day(-6), expectedAt: day(-1), supplierRef: "AB 24-118", lines: [L("HEA 200, S355J2, 6.000 mm", 8, "Stk", 348, null), L("IPE 160, S235JR, 6.000 mm", 4, "Stk", 162, null), L("Flachstahl 50×8", 60, "m", 6.4, await stockId("Flachstahl 50×8"))] },
  { number: "BE-DEMO-002", supplierId: schrauben.id, projectId: null, status: "TEILGELIEFERT", orderedAt: day(-5), expectedAt: day(2), supplierRef: null, lines: [L("Sechskantschraube M12×40 8.8 verzinkt", 400, "Stk", 0.29, await stockId("Sechskantschraube M12×40 8.8 verzinkt"), 200), L("Schweißdraht SG2 1,0 mm", 6, "Rolle", 36.5, await stockId("Schweißdraht SG2 1,0 mm"), 6)] },
  { number: "BE-DEMO-003", supplierId: verzinkerei.id, projectId: treppe.id, status: "GELIEFERT", orderedAt: day(-12), expectedAt: day(-3), supplierRef: "Los 4471", lines: [L("Feuerverzinkung Treppe + Podest, ca. 1.850 kg", 1, "psch", 1480, null, 1)] },
];
for (const o of orders) {
  const totalNet = Math.round(o.lines.reduce((t, l) => t + l.price * l.qty, 0) * 100) / 100;
  const done = o.lines.filter((l) => l.received > 0);
  await db.supplierOrder.create({
    data: { ...o, totalNet, deliveredAt: o.status === "GELIEFERT" ? day(-3) : null, createdBy: "Anna Weber", receipts: done.length ? { create: [{ lines: done.map((l) => ({ index: o.lines.indexOf(l), qty: l.received, stockItemId: l.stockItemId })), slipNo: `LS-${o.number.slice(-3)}`, userName: "Sven Müller" }] } : undefined },
  });
}

// Termine
await db.event.create({ data: { title: "Montage Treppe Käfertal", startAt: day(13), allDay: true, location: "Mannheimer Str. 112, Mannheim", projectId: treppe.id } });
await db.event.create({ data: { title: "Aufmaß Carport Viernheim", startAt: new Date(day(2).getTime() + 9 * 3600_000), projectId: (await db.project.findFirstOrThrow({ where: { name: { contains: "Carport" } } })).id } });

// Kunden, Angebote und Rechnungen (Buchhaltung) – Demo-Nummern mit Präfix DEMO-, damit echte Nummernkreise unberührt bleiben
const allProjects = await db.project.findMany();
const d0 = (id: string | null) => Object.keys(users).find((n) => users[n] === id) ?? "";
let custNo = 90001;
let docNo = 1;
const line = (name: string, net: number) => [{ name, qty: 1, unit: "psch", price: net, discount: 0, taxRate: 19 }];
const money = (net: number) => ({ netCents: Math.round(net * 100), taxCents: Math.round(net * 19), grossCents: Math.round(net * 119) });
for (const p of allProjects) {
  const c = await db.customer.create({ data: { number: custNo++, name: p.customer ?? "Kunde", kind: p.customer?.startsWith("Herr") || p.customer?.startsWith("Familie") ? "PERSON" : "FIRMA", street: p.address?.split(",")[0], zip: p.address?.split(", ")[1]?.slice(0, 5), city: p.address?.split(", ")[1]?.slice(6), email: "kunde@example.com", phone: "0621 000000" } });
  const net = p.budgetNet ?? 7400;
  const accepted = (p.budgetNet ?? 0) > 0;
  await db.project.update({ where: { id: p.id }, data: { customerId: c.id } });
  const quote = await db.salesDoc.create({ data: { kind: "ANGEBOT", status: accepted ? "ANGENOMMEN" : "OFFEN", number: `DEMO-AN-${docNo++}`, customerId: c.id, projectId: p.id, title: p.name, date: day(accepted ? -40 : -2), dueDate: day(accepted ? -10 : 28), lines: line(p.name, net), ...money(net), sentAt: day(accepted ? -40 : -2) } });
  // Automatik wie im Betrieb: angenommenes Angebot → Auftrag mit Projektakte
  if (accepted) {
    const { order } = await createOrderFromQuote(quote.id, { id: users[d0(p.leaderId)] ?? Object.values(users)[0], name: "Demo" });
    await db.order.update({ where: { id: order.id }, data: { status: "IN_ARBEIT", startDate: p.startDate, dueDate: p.endDate, material: "Siehe Angebot – Stücklisten folgen", production: "feuerverzinkt, Oberfläche nach Kundenwunsch" } });
  }
}
await db.salesDoc.create({ data: { kind: "ANGEBOT", status: "ABGELEHNT", number: `DEMO-AN-${docNo++}`, title: "Wendeltreppe Edelstahl", date: day(-60), lines: line("Wendeltreppe Edelstahl", 23800), ...money(23800) } });
// Artikelstamm und ein Angebot mit echten Positionen (für Auftragsbestätigung/Lieferschein im Arbeitsablauf)
const articles: [string, string, string, number, string][] = [
  ["100", "Montagestunde Monteur", "Std.", 68, "LEISTUNG"],
  ["101", "Werkstattstunde Metallbauer", "Std.", 62, "LEISTUNG"],
  ["110", "Feuerverzinken", "kg", 0.85, "LEISTUNG"],
  ["111", "Pulverbeschichtung RAL nach Wahl", "m²", 28, "LEISTUNG"],
  ["200", "Flachstahl 40×8 S235", "m", 9.4, "MATERIAL"],
  ["201", "Rundrohr 42,4×2,6 Handlauf", "m", 14.2, "MATERIAL"],
  ["202", "Gitterrost 30/30 verzinkt", "m²", 96, "MATERIAL"],
  ["300", "Anfahrtspauschale Rhein-Neckar", "psch", 45, "LEISTUNG"],
];
for (const [number, name, unit, priceNet, kind] of articles) await db.article.create({ data: { number, name, unit, priceNet, kind } });
const firstQuote = await db.salesDoc.findFirst({ where: { kind: "ANGEBOT", status: "ANGENOMMEN" }, orderBy: { number: "asc" } });
if (firstQuote) {
  const pos = [
    { name: "Treppengeländer Stahl nach Aufmaß", description: "Füllung Flachstahl 40×8, Pfosten 60×60, Handlauf Rundrohr 42,4", qty: 14.5, unit: "lfm", price: 285, discount: 0, taxRate: 19 },
    { name: "Feuerverzinken", qty: 420, unit: "kg", price: 0.85, discount: 0, taxRate: 19 },
    { name: "Pulverbeschichtung RAL 7016", qty: 18, unit: "m²", price: 28, discount: 0, taxRate: 19 },
    { name: "Montage vor Ort inkl. Befestigungsmaterial", qty: 16, unit: "Std.", price: 68, discount: 0, taxRate: 19 },
    { name: "Anfahrtspauschale Rhein-Neckar", qty: 2, unit: "psch", price: 45, discount: 0, taxRate: 19 },
  ];
  const net = pos.reduce((s, l) => s + Math.round(l.qty * l.price * 100), 0) / 100;
  await db.salesDoc.update({ where: { id: firstQuote.id }, data: { lines: pos, ...money(net) } });
}
await db.salesDoc.create({ data: { kind: "ANGEBOT", status: "ENTWURF", title: "Balkongeländer Edelstahl", date: day(0), lines: line("Balkongeländer Edelstahl", 6900), ...money(6900) } });

// Kundenakte: Kontakthistorie und Wiedervorlagen
const crm: [string, string, string, number | null][] = [
  ["Herr Bauer", "ANRUF", "Hat wegen Carport angerufen, möchte Variante mit Geräteraum. Angebot nachreichen.", 1],
  ["Herr Bauer", "BESUCH", "Aufmaß-Termin vor Ort vereinbart, Zufahrt eng (max. 3,5 t).", null],
  ["Hausverwaltung Krämer", "MAIL", "Glasfarbe bestätigt: VSG klar. Wünscht Montage ab KW 50.", null],
  ["Neckar Logistik AG", "ANRUF", "Einkauf (Frau Hoffmann) fragt nach Statik-Termin – zurückrufen.", -1],
  ["Familie Schneider", "NOTIZ", "Antrieb Sommer gewünscht, Funkfernbedienung 3 Stk.", 5],
];
for (const [name, kind, text, off] of crm) {
  const c = await db.customer.findFirst({ where: { name } });
  if (c) await db.customerNote.create({ data: { customerId: c.id, kind, text, followUpAt: off === null ? null : day(off), assigneeId: users["Anna Weber"], authorName: "Anna Weber" } });
}

// Fertigungsaufträge (Werkstatt)
const proj = async (part: string) => (await db.project.findFirstOrThrow({ where: { name: { contains: part } } })).id;
const jobsDemo: [string, string, string, string, string | null, string, number, number, number, string][] = [
  ["Stahltreppe", "Treppenwangen U200 zuschneiden und bohren", "2 Stk", "Bandsäge", "Sven Müller", "FERTIG", -10, -8, 6, "Wangen nach Werkplanung Blatt 2, Bohrungen Ø 14 für Stufenwinkel"],
  ["Stahltreppe", "Podest schweißen", "1 Stk", "Schweißplatz 1", "Sven Müller", "QK", -6, -1, 14, "Rahmen L 80×8, Diagonalen prüfen, Nähte a = 4 mm umlaufend"],
  ["Stahltreppe", "Geländer Treppe + Podest", "3 Felder", "Schweißplatz 2", "Tobias Kern", "IN_FERTIGUNG", -2, 4, 18, "Handlauf Ø 42,4, Füllung Flachstahl 40×8 senkrecht, Abstand < 12 cm"],
  ["Edelstahl-Geländer", "Pfosten V2A Ø 42,4 ablängen", "26 Stk", "Kreissäge", "Tobias Kern", "AV", 1, 3, 5, "Längen lt. Aufmaßliste, Enden entgraten"],
  ["Edelstahl-Geländer", "Glashalter und Bodenplatten", "26 Stk", "Bohrwerk", null, "MATERIAL_FEHLT", 2, 6, 8, "Bodenplatten 120×120×10 V2A – Lieferung offen"],
  ["Hallenvordach", "Stützen HEA 200 mit Kopf- und Fußplatten", "6 Stk", "Schweißplatz 1", "Sven Müller", "OFFEN", 8, 15, 32, "Fußplatten 300×300×20, Anker M20, Statik Pos. 3"],
  ["Hallenvordach", "Pfetten IPE 160 vorbereiten", "8 Stk", "Bandsäge", "Tobias Kern", "OFFEN", 10, 16, 16, null as unknown as string],
  ["Brandschutztüren", "Zargen vorbereiten", "6 Stk", "Montagetisch", "Mehmet Yılmaz", "MONTAGEBEREIT", -20, -15, 6, "Zargen lt. Türliste, Dübel und Schrauben beilegen"],
];
let faNo = 1;
for (const [part, title, quantity, machine, who, status, s0, e0, h, instr] of jobsDemo) {
  const done = status === "FERTIG" || status === "MONTAGEBEREIT";
  await db.productionJob.create({ data: { number: `FA-DEMO-${String(faNo++).padStart(3, "0")}`, projectId: await proj(part), title, quantity, machine, assigneeId: who ? users[who] : null, status, plannedStart: day(s0), plannedEnd: day(e0), plannedHours: h, actualHours: done ? h + 1 : null, materialOk: status !== "MATERIAL_FEHLT" && status !== "OFFEN", instructions: instr, doneAt: done ? day(e0) : null, doneBy: done ? who : null, qcAt: done ? day(e0) : null, qcBy: done ? "Josip Cabraja" : null, qcNote: done ? "Maße und Nähte geprüft, i. O." : null, priority: part === "Edelstahl-Geländer" ? "HOCH" : "NORMAL", createdBy: "Demo" } });
}

// Montagen (Baustelle) – ohne Kalender/Push, nur Demo
const at = (offset: number, h: number) => new Date(day(offset).setUTCHours(h - 1, 0, 0, 0));
const check = (n: number) => ["Material und Werkzeug vollständig", "Baustelle abgesichert", "Untergrund/Anschlüsse geprüft", "Befestigung nach Statik", "Lot und Maße kontrolliert", "Schweißnähte/Verschraubung geprüft", "Oberfläche ausgebessert", "Baustelle sauber übergeben", "Kunde eingewiesen"].map((text, i) => ({ text, done: i < n, by: i < n ? "Mehmet Yılmaz" : null, at: null }));
const asmDemo: [string, string, number, number, number, string, string, string[], string, number, string | null][] = [
  ["Brandschutztüren", "Türen T30 einbauen, Erdgeschoss + 1. OG", -3, -2, 7, "ERLEDIGT", "Mehmet Yılmaz", ["Sven Müller"], "Sprinter MA-PM 210", 9, "6 Türen eingebaut, Panikschlösser eingestellt, Schließzylinder bauseits."],
  ["Stahltreppe", "Treppe und Podest montieren", 6, 7, 7, "GEPLANT", "Mehmet Yılmaz", ["Sven Müller", "Tobias Kern"], "Pritsche MA-PM 330 + Kran", 0, null],
  ["Edelstahl-Geländer", "Aufmaß-Kontrolle und Bodenplatten setzen", 0, 0, 7, "LAEUFT", "Mehmet Yılmaz", ["Tobias Kern"], "Caddy MA-PM 105", 3, null],
];
let moNo = 1;
for (const [part, title, d0, d1, h, status, leader, crew, vehicle, n, report] of asmDemo) {
  const projectId = await proj(part);
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { address: true } });
  await db.assembly.create({ data: { number: `MO-DEMO-${String(moNo++).padStart(3, "0")}`, projectId, title, status, startAt: at(d0, h), endAt: at(d1, 16), address: p.address, vehicle, leaderId: users[leader], plan: "Anfahrt 6:30 ab Werkstatt. Dübel, Anker und Schweißgerät mitnehmen.", checklist: check(n), report, defects: part === "Brandschutztüren" ? [{ text: "Tür 1.04 schleift unten leicht – nachjustieren", fixed: false, by: leader, at: null }] : [], doneAt: status === "ERLEDIGT" ? at(d1, 16) : null, createdBy: "Demo", crew: { create: [leader, ...crew].map((n) => ({ userId: users[n] })) } } });
}

// Zeichnungen mit Index (einfache Demo-PDFs)
const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
const demoPdf = async (title: string, idx: string) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderColor: rgb(0.06, 0.3, 0.51), borderWidth: 2 });
  page.drawRectangle({ x: 120, y: 160, width: 420, height: 260, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1.5 });
  page.drawLine({ start: { x: 120, y: 160 }, end: { x: 540, y: 420 }, thickness: 1, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(`DEMO – ${title}`, { x: 40, y: 540, size: 18, font });
  page.drawText(`Index ${idx} · ProMont GmbH`, { x: 620, y: 40, size: 12, font });
  return Buffer.from(await doc.save());
};
const drawDemo: [string, string, string, string[], boolean][] = [
  ["Stahltreppe", "Treppe mit Podest – Werkplan Blatt 1", "WERKPLAN", ["Erstausgabe", "Podesthöhe +20 mm nach Aufmaß"], true],
  ["Stahltreppe", "Geländer Treppe – Detail Handlauf", "DETAIL", ["Erstausgabe"], true],
  ["Edelstahl-Geländer", "Balkongeländer Typ A – Werkplan", "WERKPLAN", ["Erstausgabe", "Glashalter geändert (Typ Q-railing)"], false],
  ["Hallenvordach", "Vordach Statik Pos. 1–4", "STATIK", ["Statik Büro Hartmann"], false],
];
let zgNo = 1;
for (const [part, title, kind, notes, release] of drawDemo) {
  const projectId = await proj(part);
  const versions = [];
  for (const [n, note] of notes.entries()) {
    const idx = String.fromCharCode(65 + n);
    const data = await demoPdf(title, idx);
    const f = await db.storedFile.create({ data: { name: `${title} Index ${idx}.pdf`, mime: "application/pdf", size: data.length, sha256: "demo", data: new Uint8Array(data), kind: "zeichnung", projectId, uploadedBy: "Josip Cabraja" } });
    versions.push({ version: n + 1, fileId: f.id, note, uploadedBy: "Josip Cabraja" });
  }
  const last = versions.length;
  // Geländer: Index A freigegeben, Index B in Prüfung
  const rel = release ? last : last > 1 ? last - 1 : null;
  await db.drawing.create({ data: { number: `ZG-DEMO-${String(zgNo++).padStart(3, "0")}`, projectId, title, kind, status: release ? "FREIGEGEBEN" : "PRUEFUNG", currentVersion: last, releasedVersion: rel, releasedAt: rel ? day(-5) : null, releasedBy: rel ? "Dirk Linke" : null, createdBy: "Josip Cabraja", versions: { create: versions } } });
}

// Urlaub & Krank: Montag nächster Woche als Bezug
const t0 = todayYmd();
const nextMon = addDaysYmd(t0, 7 - ((new Date(`${t0}T00:00:00Z`).getUTCDay() + 6) % 7));
const gf = { id: users["Dirk Linke"], name: "Dirk Linke", role: "ADMIN" };
await requestAbsence({ userId: users["Mehmet Yılmaz"], kind: "URLAUB", from: nextMon, to: addDaysYmd(nextMon, 4), note: "Familienbesuch" }, gf);
await requestAbsence({ userId: users["Tobias Kern"], kind: "KRANK", from: addDaysYmd(t0, -2), to: addDaysYmd(t0, 2), certificate: true }, gf);
await requestAbsence({ userId: users["Anna Weber"], kind: "URLAUB", from: addDaysYmd(nextMon, 14), to: addDaysYmd(nextMon, 18), note: "Vertretung: Josip" }, { id: users["Anna Weber"], name: "Anna Weber", role: "MEMBER" });
await requestAbsence({ userId: users["Sven Müller"], kind: "SONSTIGES", from: addDaysYmd(nextMon, 9), to: addDaysYmd(nextMon, 9), note: "Schweißer-Prüfung DVS" }, gf);

// Umsatz der letzten Monate (Abschlags- und Schlussrechnungen)
const firstCustomer = await db.customer.findFirstOrThrow();
for (const [off, net, paid] of [[-160, 18400, true], [-130, 26100, true], [-100, 9800, true], [-75, 31200, true], [-45, 22650, true], [-20, 14900, false], [-6, 11800, false]] as const) {
  await db.salesDoc.create({ data: { kind: "RECHNUNG", status: paid ? "BEZAHLT" : "OFFEN", number: `DEMO-RE-${docNo++}`, customerId: firstCustomer.id, title: "Abschlagsrechnung", date: day(off), dueDate: day(off + 14), lines: line("Abschlag Stahlbauarbeiten", net), ...money(net), paidCents: paid ? Math.round(net * 119) : 0, finalizedAt: day(off) } });
}

// Bautagebuch (Treppe Käfertal, letzte Arbeitstage) – Wetter hier nur Demo-Text, live holt Jarvis es vom Wetterdienst
{
  const projectId = await proj("Stahltreppe");
  const diary: [number, string, [string, number][], string, string | null, string | null, string | null][] = [
    [-6, "bedeckt, 6–11 °C, trocken, Wind bis 18 km/h", [["Mehmet Yılmaz", 8], ["Sven Müller", 8]], "Baustelle eingerichtet, Aufmaß kontrolliert, Ankerpunkte Podest gebohrt und gesetzt (8 × M16)", "Hilti-Anker HST3 M16, Bohrhammer", null, "Bauleiter Hr. Schmidt (Wohnbau Rhein-Neckar): Podesthöhe bestätigt"],
    [-5, "leichter Regen, 7–10 °C, 4 mm Niederschlag", [["Mehmet Yılmaz", 6]], "Konsolen Podest montiert, ausgerichtet", null, "Regen ab 13 Uhr – Arbeiten im Freien eingestellt (Behinderung angezeigt)", null],
    [-2, "teils bewölkt, 5–12 °C, trocken", [["Mehmet Yılmaz", 8], ["Sven Müller", 8], ["Tobias Kern", 4]], "Podest gesetzt und verschraubt, Treppenwangen eingehoben (Hubsteiger), 8 von 16 Stufen montiert", "Gitterroststufen geliefert (Lieferschein 4711), Hubsteiger 12 m gemietet", null, null],
    [-1, "sonnig, 3–13 °C, trocken, Wind bis 12 km/h", [["Mehmet Yılmaz", 8], ["Sven Müller", 7.5]], "Restliche Stufen montiert, Geländerpfosten gesetzt, Schweißnähte Podest kontrolliert", null, "Estrich im Treppenhaus noch nicht begehbar – Zugang über Nebeneingang", "Kunde vor Ort: Handlauf zusätzlich an der Wandseite gewünscht (Nachtrag)"],
  ];
  // Kopf wie im Formular des Auftraggebers (Bautagesbericht)
  await db.project.update({ where: { id: projectId }, data: { diaryHead: { client: "GOLDBECK Montage GmbH Bereich Süd", clientNo: "GB-S-24117", trade: "Stahlbau – Treppe und Podest", startNo: 38 } } });
  const reports = [
    { equipment: { telestapler: "1 × 3 Std." }, temp: 11 },
    { equipment: {}, temp: 9, rain: true, sun: false, snow: false, changes: [{ men: 1, hours: 2, crane: null, platforms: null, text: "Abdecken der Konsolen wegen Regen (Behinderung)" }] },
    { equipment: { autokran: "1 × 4 Std.", scherenbuehne: "1 × 8 Std." }, temp: 12, changes: [{ men: 2, hours: 1.5, crane: 1, platforms: null, text: "Zusätzliches Umsetzen Wangen wegen Gerüst" }], orders: "Anfahrtspauschale 78,–" },
    { equipment: { scherenbuehne: "1 × 7,5 Std." }, temp: 13, changes: [{ men: 2, hours: 3, crane: null, platforms: 3, text: "Zusatzhandlauf Wandseite aufmessen (Nachtrag)" }], orders: "Fachbauleiter Hr. Schmidt: Handlauf Wandseite zusätzlich ausführen, Nachtragsangebot bis Freitag" },
  ];
  for (const [k, [off, weather, crew, work, material, obstacles, visitors]] of diary.entries()) {
    const report = { no: 38 + k, foreman: "Mehmet Yılmaz", trade: "Stahlbau – Treppe und Podest", earlyFrom: "07:00", earlyTo: k === 1 ? "13:00" : "16:00", ...reports[k] };
    await db.diaryEntry.create({ data: { projectId, day: berlinDateTime(addDaysYmd(todayYmd(), off)), weather, weatherSource: "manuell", crew: crew.map(([name, hours]) => ({ name, userId: users[name], hours, role: name === "Mehmet Yılmaz" ? "Richtmeister" : "Monteur" })), work, material, obstacles, visitors, report, authorName: "Mehmet Yılmaz" } });
  }
}

// Abgenommenes Projekt mit Gewährleistung + Mängel
{
  const done = await db.project.create({ data: { name: "Außentreppe Kita Lindenhof", customer: "Stadt Mannheim – Fachbereich Bau", address: "Meerfeldstr. 20, 68163 Mannheim", description: "Fluchttreppe feuerverzinkt, 2 Podeste", status: "FERTIG", leaderId: users["Josip Cabraja"], startDate: day(-520), endDate: day(-430) } });
  await db.assembly.create({ data: { number: "MO-DEMO-099", projectId: done.id, title: "Montage Fluchttreppe", status: "ABGENOMMEN", startAt: day(-440), endAt: day(-436), leaderId: users["Mehmet Yılmaz"], signerName: "Fr. Becker (Stadt Mannheim)", signedAt: day(-435), doneAt: day(-436), createdBy: "Demo" } });
  const defects: [string, string, string, string, string, string | null, number, string, boolean][] = [
    ["Stahltreppe", "Schweißnaht Podest links nacharbeiten", "Podest OG, linke Wange", "SCHWER", "Sven Müller", "IN_ARBEIT", 2, "INTERN", false],
    ["Stahltreppe", "Kratzer in der Verzinkung an Stufe 6 ausbessern", "Stufe 6", "GERING", "Mehmet Yılmaz", "OFFEN", 12, "KUNDE", false],
    ["Brandschutztüren", "Tür 1.04 schleift unten – Bänder nachjustieren", "Raum 1.04, EG", "MITTEL", "Mehmet Yılmaz", "OFFEN", -1, "ABNAHME", false],
    ["Brandschutztüren", "Obentürschließer Tür 1.07 schließt zu schnell", "Raum 1.07", "MITTEL", "Mehmet Yılmaz", "BEHOBEN", 3, "ABNAHME", false],
    ["Edelstahl-Geländer", "Glasleiste Balkon 3 OG fehlt eine Schraube", "Balkon 3, OG", "GERING", "Tobias Kern", "ERLEDIGT", -3, "INTERN", false],
    ["Außentreppe Kita", "Rost an Bodenplatte Podest 1 (Gewährleistung)", "Podest 1, Fußplatte", "MITTEL", "Josip Cabraja", "OFFEN", 9, "GEWAEHRLEISTUNG", true],
  ];
  let mg = 1;
  for (const [part, title, location, severity, who, status, due, source, warranty] of defects) {
    const projectId = part === "Außentreppe Kita" ? done.id : await proj(part);
    await db.defect.create({ data: { number: `MG-DEMO-${String(mg++).padStart(3, "0")}`, projectId, title, location, severity, status: status ?? "OFFEN", source, warranty, assigneeId: users[who], dueDate: day(due), reportedBy: "Josip Cabraja", ...(status === "BEHOBEN" || status === "ERLEDIGT" ? { fixedAt: day(-1), fixedBy: who, fixNote: "Nachgearbeitet und kontrolliert." } : {}), ...(status === "ERLEDIGT" ? { closedAt: day(0), closedBy: "Josip Cabraja" } : {}) } });
  }
}

// Ausschreibungen – nur DEMO (live kommen sie aus dem EU-Amtsblatt TED bzw. Feeds)
for (const [title, buyer, plz, place, days, score, matched, status] of [
  ["DEMO – Erneuerung Geländer und Handläufe Schulzentrum", "Demo-Vergabestelle Rhein-Neckar", "68219", "Mannheim", 18, 90, "Geländer, Handlauf, CPV, PLZ 68219", "NEU"],
  ["DEMO – Stahlbauarbeiten Fahrradüberdachung Bahnhof", "Demo-Stadtwerke", "69115", "Heidelberg", 11, 70, "Stahlbau, Überdachung, PLZ 69115", "INTERESSANT"],
  ["DEMO – Fluchttreppe Verwaltungsgebäude", "Demo-Landkreis", "67059", "Ludwigshafen", 25, 70, "Treppe, Fluchttreppe, PLZ 67059", "NEU"],
  ["DEMO – Toranlage Betriebshof", "Demo-Zweckverband", "64646", "Heppenheim", 6, 50, "Tor, PLZ 64646", "NEU"],
] as const) {
  await db.tender.create({ data: { source: "MANUELL", externalId: `demo-${title}`, title, buyer, postalCode: plz, place, deadline: day(days), publishedAt: day(-3), score, matched, status, description: "Demo-Eintrag für Vorführungen. Live stehen hier Kurzbeschreibung und Link der öffentlichen Bekanntmachung." } });
}

// Liquidität: Kontostand, geplante Zahlungen, offene Ausgaben
await db.appSetting.upsert({ where: { key: "LIQUIDITAET" }, create: { key: "LIQUIDITAET", value: JSON.stringify({ balanceCents: 6_850_000, asOf: todayYmd(), reserveCents: 2_000_000, weeks: 12 }) }, update: {} });
const mon = (n: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); d.setUTCHours(0, 0, 0, 0); return d; };
await db.cashItem.createMany({ data: [
  { name: "Löhne und Gehälter", amountCents: -2_840_000, interval: "MONATLICH", startDate: new Date(mon(1).getTime() - 3 * DAY) },
  { name: "Miete Halle Ottmar-Mergenthaler-Str.", amountCents: -420_000, interval: "MONATLICH", startDate: new Date(mon(1).getTime() + 2 * DAY) },
  { name: "Leasing Transporter + Caddy", amountCents: -98_000, interval: "MONATLICH", startDate: new Date(mon(1).getTime() + 14 * DAY) },
  { name: "Umsatzsteuer-Vorauszahlung", amountCents: -910_000, interval: "MONATLICH", startDate: new Date(mon(1).getTime() + 9 * DAY) },
  { name: "Abschlag Hallenvordach Ladenburg (erwartet)", amountCents: 2_560_000, interval: "EINMALIG", startDate: day(24) },
  { name: "Schlussrechnung Balkone Neckarstadt (erwartet)", amountCents: 3_970_000, interval: "EINMALIG", startDate: day(45) },
] });
let eNo = 1;
for (const [supplier, net, off, docNo] of [["Stahlhandel Haug GmbH", 8420, 9, "R-88123"], ["Verzinkerei Rhein-Neckar", 2380, 4, "VZ-2211"], ["Glas Schwind", 6150, 16, "41-2026"], ["Würth", 640, -2, "WÜ-5531"]] as const) {
  await db.purchaseDoc.create({ data: { number: `E-DEMO-${String(eNo++).padStart(3, "0")}`, supplier, docNo, date: day(off - 14), dueDate: day(off), category: "MATERIAL", netCents: net * 100, taxCents: Math.round(net * 19), grossCents: Math.round(net * 119), status: "OFFEN", createdBy: "Demo" } });
}

// Angebotsvorlagen: Demo-Preise und -Sätze (nur wenn noch nichts eingetragen ist – echte Werte trägt der Betrieb selbst ein)
const demoSetting = async (key: string, value: object) => {
  if (!(await db.appSetting.findUnique({ where: { key } }))) await db.appSetting.create({ data: { key, value: JSON.stringify(value) } });
};
await demoSetting("STAHLPREISE", { STAHL: 1.45, EDELSTAHL: 5.9, ALU: 6.2, verzinken: 0.68, familien: {}, quelle: "Demo-Werte", stand: todayYmd() });
await demoSetting("VORLAGEN_KALK", {
  stundensatzWerkstatt: 64, stundensatzMontage: 59, pulverM2: 19, verschnitt: 10, materialZuschlag: 15, gewinnZuschlag: 18, anfahrt: 85, glasM2: 260, gitterrostStufe: 78, beschlagFluegel: 190, torantrieb: 1450,
  zeiten: {
    GELAENDER: { fertigungFix: 2, fertigungJe: 2.2, montageFix: 2, montageJe: 0.9 },
    TREPPE: { fertigungFix: 8, fertigungJe: 1.2, montageFix: 4, montageJe: 0.4 },
    VORDACH: { fertigungFix: 4, fertigungJe: 2.5, montageFix: 4, montageJe: 1 },
    TOR: { fertigungFix: 6, fertigungJe: 2, montageFix: 6, montageJe: 0.6 },
  },
  stand: todayYmd(),
});
// ---------- Routenplanung: Koordinaten (offline, damit die Demo ohne Geodienst läuft) + Touren für morgen ----------
const geo: [string, number, number][] = [
  ["Ottmar-Mergenthaler-Str. 6, 68167 Mannheim", 49.4995, 8.4935],
  ["Mannheimer Str. 112, 68309 Mannheim", 49.5163, 8.5196],
  ["Lange Rötterstr. 41, 68167 Mannheim", 49.4979, 8.4795],
  ["Benzstr. 7, 68526 Ladenburg", 49.4762, 8.6098],
  ["Bergstr. 88, 69469 Weinheim", 49.5536, 8.6683],
  ["Neckarstr. 1, 68259 Mannheim", 49.4857, 8.5505],
  ["Rathausstr. 12, 68519 Viernheim", 49.5399, 8.5781],
  ["Industriestr. 24, 68169 Mannheim", 49.5131, 8.4791],
];
const geoKey = (a: string) => a.toLowerCase().replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
for (const [address, lat, lng] of geo) await db.geoPoint.upsert({ where: { key: geoKey(address) }, create: { key: geoKey(address), address, lat, lng, source: "manuell" }, update: { lat, lng } });
const tomorrow = addDaysYmd(t0, 1);
const tAt = (h: number, m = 0) => new Date(`${tomorrow}T${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
const routeDemo: [string, string, number, string, string, string[]][] = [
  ["Schiebetor", "Torantrieb einbauen und einstellen", 13, "Bergstr. 88, 69469 Weinheim", "Sprinter MA-PM 210", ["Mehmet Yılmaz", "Sven Müller"]],
  ["Hallenvordach", "Fundamente und Anker prüfen", 8, "Benzstr. 7, 68526 Ladenburg", "Sprinter MA-PM 210", ["Mehmet Yılmaz", "Sven Müller"]],
  ["Anfrage: Carport", "Aufmaß Carport", 10, "Rathausstr. 12, 68519 Viernheim", "Sprinter MA-PM 210", ["Mehmet Yılmaz"]],
  ["Brandschutztüren", "Mangel Tür 1.04 nachjustieren", 9, "Neckarstr. 1, 68259 Mannheim", "Caddy MA-PM 105", ["Tobias Kern"]],
  ["Edelstahl-Geländer", "Glashalter montieren", 11, "Lange Rötterstr. 41, 68167 Mannheim", "Caddy MA-PM 105", ["Tobias Kern"]],
];
for (const [part, title, h, address, vehicle, crew] of routeDemo) {
  await db.assembly.create({ data: { number: `MO-DEMO-${String(moNo++).padStart(3, "0")}`, projectId: await proj(part), title, status: "GEPLANT", startAt: tAt(h), endAt: tAt(h + 2), address, vehicle, leaderId: users[crew[0]], checklist: check(0), createdBy: "Demo", crew: { create: crew.map((n) => ({ userId: users[n] })) } } });
}

// ---------- Nachunternehmer ----------
const nuDemo: [string, string, string, string, [string, number | null][], [string, string | null, number, string][]][] = [
  ["Kranverleih Rhein-Neckar (Demo)", "Kranarbeiten", "Herr Brandt", "Mannheim", [["FREISTELLUNG_48B", 400], ["UNBEDENKLICHKEIT_KK", 70], ["BG", 150], ["HAFTPFLICHT", 260]], [["Autokran 40 t – Montage Vordach", "Hallenvordach", 3800, "BEAUFTRAGT"]]],
  ["Pulverbeschichtung Heidelberg (Demo)", "Pulverbeschichtung", "Frau Lenz", "Heidelberg", [["FREISTELLUNG_48B", 12], ["UNBEDENKLICHKEIT_KK", 45], ["BG", 200], ["HAFTPFLICHT", 300], ["MINDESTLOHN", null]], [["Beschichtung Geländer RAL 7016", "Edelstahl-Geländer", 2150, "IN_ARBEIT"]]],
  ["Montageservice Kovač (Demo)", "Montage Stahlbau", "Herr Kovač", "Ludwigshafen", [["FREISTELLUNG_48B", -6], ["BG", 90], ["HAFTPFLICHT", 22]], [["Montagehelfer 2 Mann – Treppe Käfertal", "Stahltreppe", 6400, "BEAUFTRAGT"]]],
];
let nuNo = 1;
for (const [name, trade, contactName, city, docs, contracts] of nuDemo) {
  const sub = await db.subcontractor.create({ data: { name, trade, contactName, city, phone: "0621 000000", email: "kontakt@nachunternehmer.example", createdBy: "Demo" } });
  for (const [kind, off] of docs) await db.subcontractorDoc.create({ data: { subcontractorId: sub.id, kind, number: kind === "FREISTELLUNG_48B" ? `S${1000 + nuNo}-DEMO` : null, validFrom: off === null ? null : day(off - 365), validUntil: off === null ? null : day(off), createdBy: "Demo" } });
  for (const [title, part, amountNet, status] of contracts) await db.subcontractorContract.create({ data: { number: `NU-DEMO-${String(nuNo++).padStart(3, "0")}`, subcontractorId: sub.id, projectId: part ? await proj(part) : null, title, amountNet, status, startDate: day(-10), endDate: day(20), createdBy: "Demo" } });
}

// ---------- Personalakte ----------
const prof: [string, string, number, string, string | null][] = [
  ["Dirk Linke", "Metallbaumeister, Betriebsleiter", -4200, "UNBEFRISTET", null],
  ["Josip Cabraja", "Projektleiter Stahlbau", -2900, "UNBEFRISTET", null],
  ["Sven Müller", "Metallbauer (Schweißer)", -1500, "UNBEFRISTET", null],
  ["Anna Weber", "Kauffrau Büromanagement", -800, "UNBEFRISTET", null],
  ["Mehmet Yılmaz", "Monteur Stahlbau", -2100, "UNBEFRISTET", null],
  ["Tobias Kern", "Metallbauer", -340, "BEFRISTET", "25"],
];
for (const [name, jobTitle, entry, contractType, until] of prof) {
  await db.employeeProfile.create({ data: { userId: users[name], jobTitle, entryDate: day(entry), contractType, contractUntil: until ? day(Number(until)) : null, weeklyHours: name === "Anna Weber" ? 30 : 40, emergencyContact: "Demo-Kontakt, 0170 0000000", updatedBy: "Demo" } });
}
const empDocs: [string, string, string, number | null, number | null][] = [
  ["Sven Müller", "QUALIFIKATION", "Schweißerprüfung EN ISO 9606-1 (135)", 20, null],
  ["Sven Müller", "QUALIFIKATION", "Staplerschein", null, null],
  ["Sven Müller", "FUEHRERSCHEIN", "Klasse BE", 3000, 150],
  ["Tobias Kern", "QUALIFIKATION", "Schweißerprüfung EN ISO 9606-1 (135)", 500, null],
  ["Tobias Kern", "ARBEITSVERTRAG", "Befristeter Arbeitsvertrag", 25, null],
  ["Mehmet Yılmaz", "FUEHRERSCHEIN", "Klasse CE", 900, 9],
  ["Mehmet Yılmaz", "QUALIFIKATION", "Hubarbeitsbühne (IPAF/DGUV 308-008)", 410, null],
  ["Mehmet Yılmaz", "QUALIFIKATION", "Staplerschein", null, null],
  ["Mehmet Yılmaz", "ARBEITSMEDIZIN", "G41 Arbeiten mit Absturzgefahr", -4, null],
  ["Mehmet Yılmaz", "ERSTE_HILFE", "Ersthelfer-Ausbildung (DGUV)", 300, null],
  ["Josip Cabraja", "FUEHRERSCHEIN", "Klasse B", 4000, 60],
  ["Josip Cabraja", "UNTERWEISUNG", "Jahresunterweisung Arbeitsschutz", 200, null],
  ["Anna Weber", "ERSTE_HILFE", "Ersthelfer-Ausbildung (DGUV)", 28, null],
  ["Dirk Linke", "QUALIFIKATION", "Schweißaufsicht (IWT)", null, null],
];
for (const [name, kind, title, until, check] of empDocs) await db.employeeDoc.create({ data: { userId: users[name], kind, title, validUntil: until === null ? null : day(until), nextCheck: check === null ? null : day(check), issuedAt: day(-700), createdBy: "Demo" } });

// ---------- Rechnungen mit Positionen je Kunde (Jahresauswertung) und Mahnstufen ----------
const custOf = async (part: string) => (await db.project.findUniqueOrThrow({ where: { id: await proj(part) }, select: { customerId: true, id: true } }));
const L2 = (name: string, qty: number, unit: string, price: number) => ({ name, qty, unit, price, discount: 0, taxRate: 19 });
const tot = (ls: { qty: number; price: number }[]) => money(ls.reduce((t, l) => t + l.qty * l.price, 0));
const invDemo: [string, number, ReturnType<typeof L2>[], "BEZAHLT" | "OFFEN", number][] = [
  ["Brandschutztüren", -60, [L2("Stahltür T30-1 inkl. Zarge", 6, "Stk", 1650), L2("Montage Brandschutztür", 24, "Std.", 62)], "BEZAHLT", 0],
  ["Stahltreppe", -95, [L2("Stahltreppe gerade 16 Stufen, verzinkt", 1, "Stk", 14200), L2("Podest 1,2 × 2,4 m", 1, "Stk", 3900), L2("Montage Stahlbau", 40, "Std.", 62)], "BEZAHLT", 0],
  ["Edelstahl-Geländer", -40, [L2("Balkongeländer V2A mit Glasfüllung", 6, "Stk", 2480), L2("Montage Geländer", 30, "Std.", 62)], "OFFEN", -40],
  ["Hallenvordach", -28, [L2("Stahlbau Vordach HEA/IPE, verzinkt", 1, "psch", 21500), L2("Montage Stahlbau", 32, "Std.", 62)], "OFFEN", -28],
  ["Schiebetor", -30, [L2("Schiebetor freitragend 5,5 m", 1, "Stk", 6900), L2("Torantrieb Sommer inkl. Einbau", 1, "Stk", 1350)], "OFFEN", -30],
];
const dunPdf = await demoPdf("Mahnung", "–");
for (const [part, off, ls, status] of invDemo) {
  const c = await custOf(part);
  const inv = await db.salesDoc.create({ data: { kind: "RECHNUNG", status, number: `DEMO-RE-${docNo++}`, customerId: c.customerId, projectId: c.id, title: "Rechnung", date: day(off), dueDate: day(off + 14), lines: ls, ...tot(ls), paidCents: status === "BEZAHLT" ? tot(ls).grossCents : 0, finalizedAt: day(off), sentAt: day(off) } });
  // Neckar Logistik (Vordach): Zahlungserinnerung schon gesendet, Frist abgelaufen → 1. Mahnung fällig
  if (part === "Hallenvordach") {
    await db.dunning.create({ data: { docId: inv.id, level: 1, day: day(-12), openCents: inv.grossCents, dueDate: day(-5), pdf: new Uint8Array(dunPdf), sentAt: day(-12), sentTo: "kunde@example.com", userName: "Dirk Linke" } });
    await db.salesDoc.update({ where: { id: inv.id }, data: { dunningLevel: 1, dunnedAt: day(-12) } });
  }
  // Familie Schneider: Zahlung zugesagt → zurückgestellt
  if (part === "Schiebetor") await db.salesDoc.update({ where: { id: inv.id }, data: { dunningPausedUntil: day(6), dunningPauseNote: "Zahlung per Telefon zugesagt" } });
}
// Stunden über das Jahr verteilt (Auswertung je Monteur)
const yearHours: [string, string, number][] = [["Sven Müller", "Stahltreppe", 46], ["Sven Müller", "Hallenvordach", 22], ["Tobias Kern", "Edelstahl-Geländer", 38], ["Tobias Kern", "Schiebetor", 18], ["Mehmet Yılmaz", "Brandschutztüren", 30], ["Mehmet Yılmaz", "Stahltreppe", 20], ["Josip Cabraja", "Hallenvordach", 14]];
for (const [name, part, h] of yearHours) {
  const projectId = await proj(part);
  for (let k = 0; k < h / 8; k++) await db.timeEntry.create({ data: { projectId, userId: users[name], day: day(-10 - k * 6), minutes: 480, note: "Demo" } });
}
for (const name of ["Sven Müller", "Tobias Kern", "Mehmet Yılmaz"]) for (let k = 0; k < 6; k++) await db.timeEntry.create({ data: { userId: users[name], day: day(-12 - k * 9), minutes: 240, note: "Werkstatt allgemein (Demo)" } });
// Material- und Fremdkosten je Projekt (realistische Margen in Nachkalkulation und Auswertung)
const costDemo: [string, string, string, number][] = [
  ["Stahltreppe", "MATERIAL", "Stahl U200, Gitterroste, Kleinteile", 7900], ["Stahltreppe", "FREMDLEISTUNG", "Feuerverzinkung", 1480], ["Stahltreppe", "GERAET", "Kran Montage", 950],
  ["Edelstahl-Geländer", "MATERIAL", "V2A Rohr, Glashalter, VSG-Glas", 16800], ["Edelstahl-Geländer", "FREMDLEISTUNG", "Glaszuschnitt", 4200],
  ["Hallenvordach", "MATERIAL", "HEA/IPE, Trapezblech, Anker", 31500], ["Hallenvordach", "FREMDLEISTUNG", "Statik Büro Hartmann", 3800], ["Hallenvordach", "GERAET", "Autokran 40 t", 3800],
  ["Schiebetor", "MATERIAL", "Profile, Laufschiene, Antrieb", 3900], ["Schiebetor", "FREMDLEISTUNG", "Pulverbeschichtung", 950],
  ["Brandschutztüren", "MATERIAL", "6 Türen T30-1 Hersteller", 7400],
];
for (const [part, kind, label, amount] of costDemo) await db.projectCost.create({ data: { projectId: await proj(part), kind, label, amount, userName: "Demo" } });

// Kapazität: großer Auftrag in 2–3 Wochen (Überbuchung sichtbar)
await db.productionJob.create({ data: { number: `FA-DEMO-${String(faNo++).padStart(3, "0")}`, projectId: await proj("Hallenvordach"), title: "Trapezblech und Rinnen vorbereiten", quantity: "1 Satz", machine: "Schweißplatz 2", assigneeId: users["Sven Müller"], status: "OFFEN", plannedStart: day(14), plannedEnd: day(19), plannedHours: 70, createdBy: "Demo" } });
await db.productionJob.create({ data: { number: `FA-DEMO-${String(faNo++).padStart(3, "0")}`, projectId: await proj("Carport"), title: "Carport Stützen und Pfetten", quantity: "1 Satz", status: "OFFEN", plannedHours: 24, createdBy: "Demo" } });

console.log(`OK: ${projects.length} Demo-Projekte, ${people.length} Mitarbeiter (Passwort „demo-passwort“), ${items.length} Lagerartikel, 3 Lieferanten, ${orders.length} Bestellungen, ${articles.length} Artikel.`);
await db.$disconnect();
