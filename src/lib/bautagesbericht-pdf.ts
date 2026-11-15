import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { db } from "@/lib/db";
import { berlinDateTime, formatDate } from "@/lib/berlin";
import { COMPANY } from "@/lib/company";
import { DiaryError, readCrew, safe, wrap } from "@/lib/bautagebuch";
import { changeHours, changeTotals, crewByRole, EQUIPMENT, fmtNum, placeOf, readHead, readReport, weatherFlags } from "@/lib/bautagebuch-shared";

// Bautagesbericht als PDF im Aufbau des Kunden-Formulars (Auftraggeber-Vorlage, z. B. GOLDBECK Montage):
// je Tag eine A4-Seite mit Kopf, Witterung, 1. Arbeitseinsatz, 2. Geräteeinsatz, 3. Ausgeführte Arbeiten + Änderungen,
// 4. Besondere Vorkommnisse + Anordnungen und Unterschriften – danach optional eine Fotoseite.

const MM = 72 / 25.4;
const W = 210 * MM, H = 297 * MM, L = 14 * MM, R = W - 14 * MM, CW = R - L, BOTTOM = 14 * MM;
const BRAND = rgb(15 / 255, 77 / 255, 131 / 255), BRAND2 = rgb(9 / 255, 47 / 255, 80 / 255), INK = rgb(16 / 255, 24 / 255, 32 / 255), STEEL = rgb(100 / 255, 113 / 255, 124 / 255);
const LINE = rgb(200 / 255, 210 / 255, 218 / 255), MIST = rgb(242 / 255, 245 / 255, 247 / 255), SOFT = rgb(231 / 255, 240 / 255, 248 / 255), WHITE = rgb(1, 1, 1);
const WD = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" });

type Cell = { label: string; value?: string | null; w: number; check?: boolean; align?: "right" };

export async function reportPdf(projectId: string, from: string, to: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, include: { customerRef: { select: { name: true } }, order: { select: { number: true } } } });
  if (!p) throw new DiaryError("Projekt nicht gefunden.");
  const entries = await db.diaryEntry.findMany({
    where: { projectId, day: { gte: berlinDateTime(from), lte: berlinDateTime(to) } },
    orderBy: { day: "asc" },
    include: { files: { where: { mime: { in: ["image/jpeg", "image/png"] } }, orderBy: { createdAt: "asc" }, take: 6, select: { data: true, mime: true, name: true } } },
  });
  if (!entries.length) throw new DiaryError("Im gewählten Zeitraum gibt es keine Einträge.");
  const head = readHead(p.diaryHead);
  const client = head.client ?? p.customerRef?.name ?? p.customer ?? null;
  const place = head.place ?? placeOf(p.address) ?? null;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const dir = path.join(process.cwd(), "src/lib/buchhaltung/assets");
  const [reg, bold, logoBytes] = await Promise.all([readFile(path.join(dir, "Inter-Regular.ttf")), readFile(path.join(dir, "Inter-SemiBold.ttf")), readFile(path.join(process.cwd(), "public/logo.png")).catch(() => null)]);
  const font = await pdf.embedFont(reg, { subset: true }), fontB = await pdf.embedFont(bold, { subset: true });
  const logo = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null;
  pdf.setTitle(`Bautagesbericht ${p.name}`);
  pdf.setAuthor(COMPANY.name);
  pdf.setCreator("Jarvis ProMont");

  let page!: PDFPage;
  let y = 0;
  let pageNo = 0;
  let footer = "";
  const str = (f: PDFFont, s: string | null | undefined) => safe(f, s ?? "");
  const tx = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color: RGB = INK) => page.drawText(str(f, s), { x, y: yy, size, font: f, color });
  const rightText = (s: string, xr: number, yy: number, size: number, f: PDFFont = font, color: RGB = INK) => tx(s, xr - f.widthOfTextAtSize(str(f, s), size), yy, size, f, color);

  const addPage = (title: string, no: number | null | undefined, cont = false) => {
    page = pdf.addPage([W, H]);
    pageNo++;
    y = H - 10 * MM;
    // Kopf: Logo links, Auftraggeber rechts
    if (logo) {
      const h = 10 * MM, w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: L, y: y - h, width: w, height: h });
    } else tx(COMPANY.name, L, y - 8 * MM, 14, fontB, BRAND);
    if (client) {
      rightText("Auftraggeber", R, y - 3.5 * MM, 7, font, STEEL);
      const lines = wrap(str(fontB, client), fontB, 10, 85 * MM).slice(0, 2);
      lines.forEach((l, k) => rightText(l, R, y - 8 * MM - k * 4.6 * MM, 10, fontB, BRAND2));
    }
    y -= 13 * MM;
    // Titel + Bericht-Nr.
    page.drawRectangle({ x: L, y: y - 10 * MM, width: CW, height: 10 * MM, color: BRAND });
    tx(cont ? `${title} (Fortsetzung)` : title, L + 4 * MM, y - 6.9 * MM, 14, fontB, WHITE);
    if (no) {
      const nr = `Nr. ${no}`;
      const bw = fontB.widthOfTextAtSize(nr, 13) + 8 * MM;
      page.drawRectangle({ x: R - bw - 2 * MM, y: y - 8.5 * MM, width: bw, height: 7 * MM, color: WHITE });
      rightText(nr, R - 6 * MM, y - 6.4 * MM, 13, fontB, BRAND);
    }
    y -= 12 * MM;
    tx(footer, L, 8 * MM, 7, font, STEEL);
    rightText(`Seite ${pageNo}`, R, 8 * MM, 7, font, STEEL);
  };
  let current = { title: "Bautagesbericht", no: null as number | null | undefined };
  const need = (h: number) => {
    if (y - h < BOTTOM) {
      addPage(current.title, current.no, true);
      return true;
    }
    return false;
  };

  /** Zeile aus Zellen: kleine Beschriftung oben, Wert darunter (oder Kästchen) */
  const row = (cells: Cell[], h = 9 * MM) => {
    need(h);
    let x = L;
    for (const c of cells) {
      const w = c.w * CW;
      page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: LINE, borderWidth: 0.6, color: WHITE });
      tx(c.label, x + 2 * MM, y - 3.2 * MM, 6.5, font, STEEL);
      if (c.check !== undefined) {
        const s = 3.4 * MM, bx = x + 2 * MM, by = y - h + 1.6 * MM;
        page.drawRectangle({ x: bx, y: by, width: s, height: s, borderColor: c.check ? BRAND : STEEL, borderWidth: 0.8, color: c.check ? BRAND : WHITE });
        if (c.check) {
          page.drawLine({ start: { x: bx + s * 0.2, y: by + s * 0.5 }, end: { x: bx + s * 0.42, y: by + s * 0.25 }, thickness: 1.3, color: WHITE });
          page.drawLine({ start: { x: bx + s * 0.42, y: by + s * 0.25 }, end: { x: bx + s * 0.82, y: by + s * 0.78 }, thickness: 1.3, color: WHITE });
        }
        tx(c.check ? "ja" : "nein", bx + s + 1.6 * MM, by + 0.6 * MM, 8.5, font, c.check ? INK : STEEL);
      } else if (c.value) {
        const v = wrap(str(fontB, c.value), fontB, 9.5, w - 4 * MM)[0] ?? "";
        if (c.align === "right") rightText(v, x + w - 2 * MM, y - h + 2 * MM, 9.5, fontB);
        else tx(v, x + 2 * MM, y - h + 2 * MM, 9.5, fontB);
      }
      x += w;
    }
    y -= h;
  };

  const section = (title: string) => {
    need(18 * MM);
    y -= 2.5 * MM;
    page.drawRectangle({ x: L, y: y - 5.5 * MM, width: CW, height: 5.5 * MM, color: SOFT });
    page.drawRectangle({ x: L, y: y - 5.5 * MM, width: 1.2 * MM, height: 5.5 * MM, color: BRAND });
    tx(title, L + 3.5 * MM, y - 3.9 * MM, 9.5, fontB, BRAND2);
    y -= 5.5 * MM;
  };

  /** Textfeld mit Beschriftung und Linien (wie die Schreibzeilen im Formular), bricht auf neue Seiten um */
  const textBox = (label: string, value: string | null | undefined, minLines = 2) => {
    const lh = 4.7 * MM;
    const lines = value ? wrap(str(font, value), font, 9.3, CW - 6 * MM) : [];
    while (lines.length < minLines) lines.push("");
    need(4.6 * MM + lh * Math.min(lines.length, 3));
    let top = y;
    page.drawRectangle({ x: L, y: y - 4.6 * MM, width: CW, height: 4.6 * MM, color: MIST });
    tx(label, L + 2 * MM, y - 3.2 * MM, 7, fontB, STEEL);
    y -= 4.6 * MM;
    const close = () => page.drawRectangle({ x: L, y, width: CW, height: top - y, borderColor: LINE, borderWidth: 0.6 });
    for (const [k, l] of lines.entries()) {
      if (y - lh < BOTTOM) {
        close();
        addPage(current.title, current.no, true);
        top = y;
      }
      if (k > 0) page.drawLine({ start: { x: L + 2 * MM, y }, end: { x: R - 2 * MM, y }, thickness: 0.3, color: LINE });
      if (l) tx(l, L + 3 * MM, y - lh + 1.4 * MM, 9.3);
      y -= lh;
    }
    close();
  };

  /** Tabelle mit Kopfzeile, Zeilen und Summenzeile */
  const table = (cols: { label: string; w: number; align?: "right" }[], rows: string[][], sum?: string[]) => {
    const rh = 5 * MM;
    const drawRow = (vals: string[], kind: "head" | "body" | "sum") => {
      need(rh);
      let x = L;
      cols.forEach((c, k) => {
        const w = c.w * CW;
        page.drawRectangle({ x, y: y - rh, width: w, height: rh, borderColor: LINE, borderWidth: 0.6, color: kind === "head" ? MIST : kind === "sum" ? SOFT : WHITE });
        const f = kind === "body" ? font : fontB, size = kind === "head" ? 7.5 : 9;
        const v = wrap(str(f, vals[k] ?? ""), f, size, w - 3 * MM)[0] ?? "";
        if (c.align === "right" && kind !== "head") rightText(v, x + w - 1.6 * MM, y - rh + 1.6 * MM, size, f, INK);
        else tx(v, x + 1.6 * MM, y - rh + 1.6 * MM, size, f, kind === "head" ? STEEL : INK);
        x += w;
      });
      y -= rh;
    };
    drawRow(cols.map((c) => c.label), "head");
    rows.forEach((r) => drawRow(r, "body"));
    if (sum) drawRow(sum, "sum");
  };

  const n = (v: number | null | undefined) => (v ? fmtNum(v) : "");

  for (const e of entries) {
    const r = readReport(e.report);
    const crew = readCrew(e.crew);
    const wx = weatherFlags(r, e);
    const date = formatDate(e.day);
    current = { title: "Bautagesbericht", no: r.no };
    footer = `${COMPANY.name} · ${COMPANY.street} · ${COMPANY.zip} ${COMPANY.city} · ${COMPANY.phone} · Bautagesbericht ${r.no ? `Nr. ${r.no} ` : ""}vom ${date}`;
    addPage(current.title, r.no);

    // Kopf
    row([{ label: "Ausführender Richtmeister", value: r.foreman, w: 0.5 }, { label: "Gewerk", value: r.trade ?? head.trade, w: 0.5 }]);
    row([{ label: "Projekt", value: p.name, w: 0.7 }, { label: "Projekt-Nr.", value: head.clientNo ?? p.order?.number ?? null, w: 0.3 }]);
    row([{ label: "Ort", value: place, w: 0.4 }, { label: "Tag", value: WD.format(e.day), w: 0.25 }, { label: "Datum", value: date, w: 0.35 }]);
    // Witterung
    row([
      { label: "Temperatur", value: wx.temp === null ? null : `${wx.temp} °C`, w: 0.16 },
      { label: "Sonne", check: wx.sun, w: 0.12 },
      { label: "Regen", check: wx.rain, w: 0.12 },
      { label: "Schnee", check: wx.snow, w: 0.12 },
      { label: `Witterung${e.weatherSource === "open-meteo" ? " (Wetterdienst)" : ""}`, value: e.weather, w: 0.48 },
    ]);

    // 1. Arbeitseinsatz
    section("1. Arbeitseinsatz");
    row([
      { label: "Früh- / Tagschicht  von – bis", value: r.earlyFrom || r.earlyTo ? `${r.earlyFrom ?? "…"} – ${r.earlyTo ?? "…"} Uhr` : null, w: 0.5 },
      { label: "Spät- / Nachtschicht  von – bis", value: r.lateFrom || r.lateTo ? `${r.lateFrom ?? "…"} – ${r.lateTo ?? "…"} Uhr` : null, w: 0.5 },
    ]);
    const groups = crewByRole(crew);
    const totalHours = groups.reduce((s, g) => s + g.hours, 0);
    table(
      [{ label: "Funktion", w: 0.22 }, { label: "Anzahl", w: 0.1, align: "right" }, { label: "Namen", w: 0.56 }, { label: "Std.", w: 0.12, align: "right" }],
      groups.map((g) => [g.label, g.count ? String(g.count) : "", g.names.join(", "), n(g.hours)]),
      ["Gesamt", String(crew.length), "", n(totalHours)],
    );
    textBox("Bemerkungen / Besuche", e.visitors, 2);

    // 2. Geräteeinsatz
    section("2. Geräteeinsatz");
    for (let k = 0; k < EQUIPMENT.length; k += 3) row(EQUIPMENT.slice(k, k + 3).map(([key, label]) => ({ label, value: r.equipment?.[key] || null, w: 1 / 3 })), 8.5 * MM);
    if (e.material) textBox("Material / Lieferungen", e.material, 1);

    // 3. Ausgeführte Arbeiten + Änderungen
    section("3. Ausgeführte Arbeiten");
    textBox("Ausgeführte Arbeiten", e.work, 5);
    const changes = r.changes ?? [];
    const tot = changeTotals(changes);
    need(24 * MM);
    y -= 1.5 * MM;
    tx("Änderungen / Zusatzleistungen", L, y - 3.2 * MM, 8, fontB, BRAND2);
    y -= 4.6 * MM;
    const rows = changes.map((c) => [n(c.men), n(c.hours), n(changeHours(c)), n(c.crane), n(c.platforms), c.text ?? ""]);
    while (rows.length < 2) rows.push(["", "", "", "", "", ""]);
    table(
      [{ label: "Mann", w: 0.09, align: "right" }, { label: "Std.", w: 0.09, align: "right" }, { label: "∑ Stunden", w: 0.12, align: "right" }, { label: "Kran-Std.", w: 0.11, align: "right" }, { label: "Bühnen", w: 0.1, align: "right" }, { label: "Beschreibung", w: 0.49 }],
      rows,
      ["Summe", "", fmtNum(tot.hours), fmtNum(tot.crane), fmtNum(tot.platforms), ""],
    );

    // 4. Besondere Vorkommnisse
    section("4. Besondere Vorkommnisse");
    textBox("Besondere Vorkommnisse / Behinderungen", e.obstacles, 2);
    textBox("Anordnungen", r.orders, 2);

    // Unterschriften
    need(18 * MM);
    y -= 12 * MM;
    const cols = [
      [`${place ? `${place}, ` : ""}${date}`, "Ort, Datum"],
      ["", `Richtmeister ${COMPANY.short}`],
      ["", "Unterschrift Fachbauleiter"],
    ];
    const cw = (CW - 8 * MM) / 3;
    cols.forEach(([v, l], k) => {
      const x = L + k * (cw + 4 * MM);
      if (v) tx(v, x, y + 1.5 * MM, 9.5);
      page.drawLine({ start: { x, y }, end: { x: x + cw, y }, thickness: 0.7, color: INK });
      tx(l, x, y - 3.6 * MM, 7.5, font, STEEL);
    });
    y -= 6 * MM;

    // Fotos zum Bericht (eigene Seite, zwei je Reihe)
    const imgs: PDFImage[] = [];
    for (const f of e.files) {
      const img = await (f.mime === "image/png" ? pdf.embedPng(f.data) : pdf.embedJpg(f.data)).catch(() => null);
      if (img) imgs.push(img);
    }
    if (imgs.length) {
      current = { title: "Fotodokumentation", no: r.no };
      addPage(current.title, r.no);
      tx(`zum Bautagesbericht vom ${WD.format(e.day)}, ${date} · ${p.name}`, L, y, 9, font, STEEL);
      y -= 5 * MM;
      const colW = (CW - 5 * MM) / 2, maxH = 72 * MM;
      for (let k = 0; k < imgs.length; k += 2) {
        const pair = imgs.slice(k, k + 2).map((img) => {
          const s = Math.min(colW / img.width, maxH / img.height);
          return { img, w: img.width * s, h: img.height * s };
        });
        const rh = Math.max(...pair.map((q) => q.h));
        need(rh + 6 * MM);
        pair.forEach((q, j) => page.drawImage(q.img, { x: L + j * (colW + 5 * MM) + (colW - q.w) / 2, y: y - q.h - 2 * MM, width: q.w, height: q.h }));
        y -= rh + 6 * MM;
      }
    }
  }

  const first = readReport(entries[0].report).no;
  const tag = entries.length === 1 ? `${first ? `Nr-${first}-` : ""}${from}` : `${from}_${to}`;
  return { bytes: await pdf.save(), name: `Bautagesbericht-${p.name.replace(/[^\wäöüÄÖÜß-]+/g, "-").slice(0, 50)}-${tag}.pdf` };
}
