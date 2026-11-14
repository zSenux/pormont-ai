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

// Umsatz der letzten Monate (Abschlags- und Schlussrechnungen)
const firstCustomer = await db.customer.findFirstOrThrow();
for (const [off, net, paid] of [[-160, 18400, true], [-130, 26100, true], [-100, 9800, true], [-75, 31200, true], [-45, 22650, true], [-20, 14900, false], [-6, 11800, false]] as const) {
  await db.salesDoc.create({ data: { kind: "RECHNUNG", status: paid ? "BEZAHLT" : "OFFEN", number: `DEMO-RE-${docNo++}`, customerId: firstCustomer.id, title: "Abschlagsrechnung", date: day(off), dueDate: day(off + 14), lines: line("Abschlag Stahlbauarbeiten", net), ...money(net), paidCents: paid ? Math.round(net * 119) : 0, finalizedAt: day(off) } });
}

console.log(`OK: ${projects.length} Demo-Projekte, ${people.length} Mitarbeiter (Passwort „demo-passwort“), ${items.length} Lagerartikel, 3 Lieferanten.`);
await db.$disconnect();
