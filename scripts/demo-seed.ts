// Demo-Beispieldaten für einen Metallbau-Betrieb (Projekte mit Phasen, Team, Meilensteine, Aufgaben, Lager, Lieferanten).
// NUR für lokale Tests und Vorführungen – niemals gegen die Live-Datenbank:
//   pnpm demo:seed
// Läuft nicht bei NODE_ENV=production und nicht, wenn schon Projekte existieren (außer DEMO_FORCE=1).
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { PHASES } from "../src/lib/phases-shared";

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
  ["dirk.linke@demo.promont", "Dirk Linke", "ADMIN"],
  ["josip.cabraja@demo.promont", "Josip Cabraja", "ADMIN"],
  ["sven.mueller@demo.promont", "Sven Müller", "MEMBER"],
  ["anna.weber@demo.promont", "Anna Weber", "MEMBER"],
  ["mehmet.yilmaz@demo.promont", "Mehmet Yılmaz", "MEMBER"],
  ["tobias.kern@demo.promont", "Tobias Kern", "MEMBER"],
] as const;
const users: Record<string, string> = {};
for (const [email, name, role] of people) {
  const u = await db.user.upsert({ where: { email }, create: { email, name, role, passwordHash: pw }, update: {} });
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

console.log(`OK: ${projects.length} Demo-Projekte, ${people.length} Mitarbeiter (Passwort „demo-passwort“), ${items.length} Lagerartikel, 3 Lieferanten.`);
await db.$disconnect();
