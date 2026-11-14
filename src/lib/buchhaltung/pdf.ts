import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { AFRelationship, PDFDocument, PDFHexString, PDFName, PDFString, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY } from "@/lib/company";
import { fmtIban } from "./config";
import { fmtEuroCents, fmtNum, fmtPrice, lineNetCents } from "./money";
import { KIND_LABEL, type DocData, type Party } from "./types";
import { REVERSE_CHARGE_TEXT } from "./xrechnung";

// PDF für Angebote, Rechnungen, Gutschriften und Mahnungen im ProMont-Briefbogen (DIN 5008, Form B).
// Rechnungen/Gutschriften werden als PDF/A-3 mit eingebetteter E-Rechnung (ZUGFeRD/Factur-X EN 16931) erzeugt.

const MM = 72 / 25.4;
const W = 210 * MM;
const H = 297 * MM;
const LEFT = 25 * MM;
const RIGHT = W - 20 * MM;
const FOOTER_TOP = 30 * MM;

const BRAND = rgb(15 / 255, 77 / 255, 131 / 255);
const INK = rgb(16 / 255, 24 / 255, 32 / 255);
const STEEL = rgb(100 / 255, 113 / 255, 124 / 255);
const LINE = rgb(216 / 255, 224 / 255, 230 / 255);
const MIST = rgb(242 / 255, 245 / 255, 247 / 255);

// sRGB-Farbprofil (Compact ICC Profiles, CC0) – Pflicht für PDF/A
const SRGB_ICC =
  "AAAByGxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5knZEAPUCAsD1AdCyBnqUijgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAABgZ1RSQwAAAWgAAABgYlRSQwAAAWgAAABgZGVzYwAAAAAAAAAFdVJHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAqAAAAfAD4AZwCdQODBMkGTggSChgMYg70Ec8U9hhqHC4gQySsKWoufjPrObM/1kZXTTZUdlwXZB1shnVWfo2ILJI2nKunjLLbvpnKx9dl5Hfx+f//";

type Fonts = { regular: PDFFont; bold: PDFFont };

let fontCache: Promise<{ regular: Uint8Array; bold: Uint8Array; logo: Uint8Array }> | null = null;
function assets() {
  fontCache ??= (async () => {
    const dir = path.join(process.cwd(), "src/lib/buchhaltung/assets");
    const [regular, bold, logo] = await Promise.all([readFile(path.join(dir, "Inter-Regular.ttf")), readFile(path.join(dir, "Inter-SemiBold.ttf")), readFile(path.join(process.cwd(), "public/logo.png"))]);
    return { regular, bold, logo };
  })().catch((e) => {
    fontCache = null;
    throw e;
  });
  return fontCache;
}

const fmtDate = (ymd: string | null | undefined) => (ymd ? ymd.split("-").reverse().join(".") : "–");
const managers = () => COMPANY.managers.map((m) => m.replace(/\s*\(.*\)$/, "")).join(", ");

/** Text umbrechen (an Leerzeichen, harte Umbrüche bleiben) */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // Überlange Wörter hart trennen
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Nur Zeichen, die die Schrift kennt (sonst bricht pdf-lib ab) */
function clean(s: string, font: PDFFont) {
  const set = font.getCharacterSet();
  return [...s.normalize("NFC")].map((ch) => (ch === "\n" || set.includes(ch.codePointAt(0)!) ? ch : ch === "\t" ? " " : "?")).join("");
}

class Letter {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(
    public doc: PDFDocument,
    public f: Fonts,
    public logo: PDFImage,
    public opts: { headerLabel: string; bank: { iban: string; bic: string; bankName: string; taxNumber: string }; draft: boolean },
  ) {}

  text(s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const font = o.bold ? this.f.bold : this.f.regular;
    const size = o.size ?? 9.5;
    const t = clean(s, font);
    const w = font.widthOfTextAtSize(t, size);
    const dx = o.align === "right" ? -w : o.align === "center" ? -w / 2 : 0;
    this.page.drawText(t, { x: x + dx, y, size, font, color: o.color ?? INK });
    return w;
  }

  /** Mehrzeiliger Text ab this.y, bricht bei Bedarf auf die nächste Seite um */
  para(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; width?: number; x?: number; gap?: number } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.f.bold : this.f.regular;
    const lh = size * 1.4;
    for (const l of wrap(clean(s, font), font, size, o.width ?? RIGHT - (o.x ?? LEFT))) {
      this.ensure(lh);
      if (l) this.text(l, o.x ?? LEFT, this.y - size, { size, bold: o.bold, color: o.color });
      this.y -= lh;
    }
    this.y -= o.gap ?? 0;
  }

  newPage(first: boolean) {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    const logoW = 58 * MM;
    const logoH = (logoW * this.logo.height) / this.logo.width;
    if (first) {
      this.page.drawImage(this.logo, { x: RIGHT - logoW, y: H - 12 * MM - logoH, width: logoW, height: logoH });
    } else {
      const sw = 32 * MM;
      this.page.drawImage(this.logo, { x: RIGHT - sw, y: H - 12 * MM - (sw * this.logo.height) / this.logo.width, width: sw, height: (sw * this.logo.height) / this.logo.width });
      this.text(this.opts.headerLabel, LEFT, H - 18 * MM, { size: 9, color: STEEL });
    }
    if (this.opts.draft) {
      this.page.drawText("ENTWURF", { x: 45 * MM, y: 95 * MM, size: 96, font: this.f.bold, color: rgb(0.93, 0.95, 0.97), rotate: degrees(40) });
    }
    this.footer();
    this.y = first ? H - 45 * MM : H - 30 * MM;
  }

  ensure(h: number, onBreak?: () => void) {
    if (this.y - h < FOOTER_TOP + 6 * MM) {
      this.newPage(false);
      onBreak?.();
    }
  }

  footer() {
    const p = this.page;
    p.drawLine({ start: { x: LEFT, y: FOOTER_TOP - 2 * MM }, end: { x: RIGHT, y: FOOTER_TOP - 2 * MM }, thickness: 0.5, color: LINE });
    const b = this.opts.bank;
    const cols: string[][] = [
      [COMPANY.name, COMPANY.street, `${COMPANY.zip} ${COMPANY.city}`],
      [`Tel. ${COMPANY.phone}`, COMPANY.email, COMPANY.website.replace(/^https?:\/\//, "")],
      b.iban ? [b.bankName || "Bankverbindung", `IBAN ${fmtIban(b.iban)}`, b.bic ? `BIC ${b.bic}` : ""] : ["Bankverbindung", "bitte in den Einstellungen", "eintragen"],
      [`Geschäftsführer: ${managers()}`, `${COMPANY.register}`, `USt-IdNr. ${COMPANY.vatId}`, b.taxNumber ? `Steuernummer ${b.taxNumber}` : ""],
    ];
    const widths = [34, 33, 44, 54].map((m) => m * MM);
    let x = LEFT;
    cols.forEach((c, i) => {
      c.forEach((line, j) => {
        if (!line) return;
        const font = j === 0 && i === 0 ? this.f.bold : this.f.regular;
        let t = clean(line, font);
        while (font.widthOfTextAtSize(t, 6.5) > widths[i] - 2 * MM && t.length > 4) t = `${t.slice(0, -2)}…`;
        p.drawText(t, { x, y: FOOTER_TOP - 6 * MM - j * 3.4 * MM, size: 6.5, font, color: STEEL });
      });
      x += widths[i];
    });
  }

  /** Absenderzeile, Anschrift und Info-Block (erste Seite) */
  head(buyer: Party, info: [string, string][]) {
    const sender = `${COMPANY.name} · ${COMPANY.street} · ${COMPANY.zip} ${COMPANY.city}`;
    this.text(sender, LEFT, H - 50 * MM, { size: 7, color: STEEL });
    this.page.drawLine({ start: { x: LEFT, y: H - 51.2 * MM }, end: { x: LEFT + this.f.regular.widthOfTextAtSize(clean(sender, this.f.regular), 7), y: H - 51.2 * MM }, thickness: 0.3, color: STEEL });
    const addr = [buyer.name, buyer.contactName ? `z. Hd. ${buyer.contactName}` : null, buyer.street, [buyer.zip, buyer.city].filter(Boolean).join(" "), buyer.country && buyer.country !== "DE" ? buyer.country : null].filter(Boolean) as string[];
    let y = H - 57 * MM;
    for (const a of addr.slice(0, 6)) {
      let t = clean(a, this.f.regular);
      while (this.f.regular.widthOfTextAtSize(t, 10) > 82 * MM && t.length > 4) t = `${t.slice(0, -2)}…`;
      this.text(t, LEFT, y, { size: 10 });
      y -= 4.6 * MM;
    }
    const ix = 125 * MM;
    let iy = H - 50 * MM;
    for (const [k, v] of info) {
      this.text(k, ix, iy, { size: 8.5, color: STEEL });
      this.text(v, RIGHT, iy, { size: 8.5, align: "right" });
      iy -= 4.4 * MM;
    }
    this.y = Math.min(H - 98 * MM, iy - 8 * MM);
  }

  finishPageNumbers() {
    const n = this.pages.length;
    if (n < 2) return;
    this.pages.forEach((p, i) => {
      const t = `Seite ${i + 1} von ${n}`;
      p.drawText(t, { x: RIGHT - this.f.regular.widthOfTextAtSize(t, 7), y: FOOTER_TOP + 1 * MM, size: 7, font: this.f.regular, color: STEEL });
    });
  }
}

async function newDoc(title: string, opts: { headerLabel: string; bank: Letter["opts"]["bank"]; draft: boolean }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const a = await assets();
  const fonts = { regular: await doc.embedFont(a.regular, { subset: true }), bold: await doc.embedFont(a.bold, { subset: true }) };
  const logo = await doc.embedPng(a.logo);
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setAuthor(COMPANY.name);
  doc.setLanguage("de-DE");
  return { doc, letter: new Letter(doc, fonts, logo, opts) };
}

/** PDF/A-3b-Kennzeichnung: XMP-Metadaten, Farbprofil, Datei-ID; optional E-Rechnung als factur-x.xml anhängen */
async function pdfA(doc: PDFDocument, title: string, xml: string | null) {
  const now = new Date();
  now.setMilliseconds(0);
  const iso = now.toISOString().replace(/\.000Z$/, "Z");
  const producer = "Jarvis ProMont (pdf-lib)";
  doc.setProducer(producer);
  doc.setCreator("Jarvis ProMont");
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  if (xml) {
    await doc.attach(new TextEncoder().encode(xml), "factur-x.xml", { mimeType: "text/xml", description: "Factur-X/ZUGFeRD Rechnung", creationDate: now, modificationDate: now, afRelationship: AFRelationship.Alternative });
  }

  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fx = xml
    ? `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${[
        ["DocumentFileName", "The name of the embedded XML document"],
        ["DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER"],
        ["Version", "The actual version of the standard applying to the embedded XML document"],
        ["ConformanceLevel", "The conformance level of the embedded XML document"],
      ]
        .map(([n, d]) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${n}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${d}</pdfaProperty:description></rdf:li>`)
        .join("")}</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>`
    : "";
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${x(title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${x(COMPANY.name)}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>Jarvis ProMont</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:MetadataDate>${iso}</xmp:MetadataDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${producer}</pdf:Producer></rdf:Description>
${fx}
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  const ctx = doc.context;
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(meta));

  const icc = ctx.stream(Buffer.from(SRGB_ICC, "base64"), { N: 3 });
  doc.catalog.set(
    PDFName.of("OutputIntents"),
    ctx.obj([ctx.obj({ Type: "OutputIntent", S: "GTS_PDFA1", OutputConditionIdentifier: PDFString.of("sRGB"), Info: PDFString.of("sRGB IEC61966-2.1"), DestOutputProfile: ctx.register(icc) })]),
  );
  doc.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: false }));
  const id = createHash("md5").update(`${title}|${iso}|${Math.random()}`).digest("hex");
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}

/** PDF für Angebot/Rechnung/Gutschrift. Mit xml → PDF/A-3 mit eingebetteter E-Rechnung (ZUGFeRD). */
export async function renderDocPdf(d: DocData, xml: string | null = null): Promise<Uint8Array> {
  const label = KIND_LABEL[d.kind];
  const title = d.number ? `${label} ${d.number}` : `${label} (Entwurf)`;
  const { doc, letter: L } = await newDoc(title, { headerLabel: title, bank: d.config, draft: !d.number });
  L.newPage(true);

  const info: [string, string][] = [
    [`${label}snummer`, d.number ?? "Entwurf"],
    [`${label}sdatum`, fmtDate(d.date)],
  ];
  if (d.buyer.customerNo) info.push(["Kundennummer", String(d.buyer.customerNo)]);
  if (d.kind !== "ANGEBOT") {
    const from = d.serviceFrom ?? d.date;
    const to = d.serviceTo ?? from;
    info.push([from === to ? "Leistungsdatum" : "Leistungszeitraum", from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`]);
  }
  if (d.kind === "ANGEBOT" && d.dueDate) info.push(["Gültig bis", fmtDate(d.dueDate)]);
  if (d.kind === "RECHNUNG" && d.dueDate) info.push(["Zahlbar bis", fmtDate(d.dueDate)]);
  if (d.preceding) info.push(["Zu Rechnung", d.preceding.number]);
  if (d.buyer.buyerReference) info.push(["Ihre Referenz", d.buyer.buyerReference.slice(0, 30)]);
  if (d.reverseCharge && d.buyer.vatId) info.push(["Ihre USt-IdNr.", d.buyer.vatId]);
  L.head(d.buyer, info);

  // Titel
  const heading = d.kind === "GUTSCHRIFT" && d.preceding ? `Gutschrift / Stornorechnung ${d.number ?? ""}`.trim() : `${label} ${d.number ?? ""}`.trim();
  L.text(heading, LEFT, L.y - 14, { size: 15, bold: true, color: BRAND });
  L.y -= 22;
  if (d.title) L.para(d.title, { bold: true, size: 10.5, gap: 2 });
  if (d.projectName) L.para(`Bauvorhaben: ${d.projectName}`, { color: STEEL, size: 9, gap: 2 });
  L.y -= 6;
  const greeting = d.buyer.greeting || "Sehr geehrte Damen und Herren,";
  if (d.intro) {
    L.para(greeting, { gap: 4 });
    L.para(d.intro, { gap: 8 });
  }

  // Positionen
  const mixed = new Set(d.lines.map((l) => l.taxRate)).size > 1 && !d.reverseCharge;
  const cols = { pos: LEFT, name: LEFT + 9 * MM, qty: RIGHT - (mixed ? 68 : 57) * MM, price: RIGHT - (mixed ? 34 : 23) * MM, tax: RIGHT - 23 * MM, total: RIGHT };
  const nameW = cols.qty - 17 * MM - cols.name;
  const tableHead = () => {
    L.page.drawRectangle({ x: LEFT, y: L.y - 6.5 * MM, width: RIGHT - LEFT, height: 6.5 * MM, color: MIST });
    const y = L.y - 4.4 * MM;
    L.text("Pos.", cols.pos + 1.5 * MM, y, { size: 8, bold: true, color: STEEL });
    L.text("Bezeichnung", cols.name, y, { size: 8, bold: true, color: STEEL });
    L.text("Menge", cols.qty, y, { size: 8, bold: true, color: STEEL, align: "right" });
    L.text("Einzelpreis", cols.price, y, { size: 8, bold: true, color: STEEL, align: "right" });
    if (mixed) L.text("USt.", cols.tax, y, { size: 8, bold: true, color: STEEL, align: "right" });
    L.text("Gesamt", cols.total - 1.5 * MM, y, { size: 8, bold: true, color: STEEL, align: "right" });
    L.y -= 9 * MM;
  };
  L.ensure(20 * MM);
  tableHead();
  d.lines.forEach((l, i) => {
    const nameLines = wrap(clean(l.name, L.f.bold), L.f.bold, 9.5, nameW);
    const descLines = l.description ? wrap(clean(l.description, L.f.regular), L.f.regular, 8.5, nameW) : [];
    const disc = l.discount ? [`abzgl. ${fmtNum(l.discount, 2)} % Rabatt`] : [];
    const rest = [...descLines, ...disc];
    const h = nameLines.length * 13 + rest.length * 11.5 + 5;
    L.ensure(Math.min(h, 120 * MM), tableHead);
    const top = L.y;
    L.text(String(i + 1), cols.pos + 1.5 * MM, top - 9.5, { size: 9 });
    L.text(`${fmtNum(l.qty)} ${l.unit}`, cols.qty, top - 9.5, { size: 9, align: "right" });
    L.text(fmtPrice(l.price), cols.price, top - 9.5, { size: 9, align: "right" });
    if (mixed) L.text(`${l.taxRate} %`, cols.tax, top - 9.5, { size: 9, align: "right" });
    L.text(fmtEuroCents(lineNetCents(l)), cols.total - 1.5 * MM, top - 9.5, { size: 9, align: "right" });
    for (const n of nameLines) {
      L.ensure(13, tableHead);
      L.text(n, cols.name, L.y - 9.5, { size: 9.5, bold: true });
      L.y -= 13;
    }
    for (const n of rest) {
      L.ensure(11.5, tableHead);
      if (n) L.text(n, cols.name, L.y - 8.5, { size: 8.5, color: STEEL });
      L.y -= 11.5;
    }
    L.y -= 5;
    L.page.drawLine({ start: { x: LEFT, y: L.y + 2 }, end: { x: RIGHT, y: L.y + 2 }, thickness: 0.4, color: LINE });
  });

  // Summen
  const t = d.totals;
  const rows: [string, string, boolean][] = [["Summe netto", fmtEuroCents(t.netCents), false]];
  for (const g of t.taxes) {
    if (d.reverseCharge) continue;
    rows.push([`zzgl. ${g.rate} % USt.${t.taxes.length > 1 ? ` auf ${fmtEuroCents(g.netCents)}` : ""}`, fmtEuroCents(g.taxCents), false]);
  }
  rows.push([d.kind === "GUTSCHRIFT" ? "Gutschriftsbetrag" : "Gesamtbetrag", fmtEuroCents(t.grossCents), true]);
  L.ensure(rows.length * 5.5 * MM + 6 * MM);
  L.y -= 3 * MM;
  for (const [k, v, strong] of rows) {
    if (strong) {
      L.page.drawRectangle({ x: RIGHT - 80 * MM, y: L.y - 6.5 * MM, width: 80 * MM, height: 7.5 * MM, color: BRAND });
      L.text(k, RIGHT - 78 * MM, L.y - 4.6 * MM, { size: 10, bold: true, color: rgb(1, 1, 1) });
      L.text(v, RIGHT - 2 * MM, L.y - 4.6 * MM, { size: 10, bold: true, color: rgb(1, 1, 1), align: "right" });
      L.y -= 9 * MM;
    } else {
      L.text(k, RIGHT - 78 * MM, L.y - 3.6 * MM, { size: 9, color: STEEL });
      L.text(v, RIGHT - 2 * MM, L.y - 3.6 * MM, { size: 9, align: "right" });
      L.y -= 5.5 * MM;
    }
  }
  L.y -= 4 * MM;

  // Hinweise
  if (d.reverseCharge) L.para(`${REVERSE_CHARGE_TEXT}: Die Umsatzsteuer schuldet der Leistungsempfänger.`, { bold: true, gap: 6 });
  if (d.kind === "RECHNUNG") {
    L.para(d.dueDate ? `Bitte überweisen Sie den Gesamtbetrag ohne Abzug bis zum ${fmtDate(d.dueDate)} unter Angabe der Rechnungsnummer ${d.number ?? ""} auf das unten genannte Konto.` : "Der Betrag ist sofort ohne Abzug fällig.", { gap: 6 });
  }
  if (d.kind === "GUTSCHRIFT" && d.preceding) L.para(`Diese Gutschrift storniert die Rechnung ${d.preceding.number} vom ${fmtDate(d.preceding.date)}.`, { gap: 6 });
  if (d.kind === "ANGEBOT" && d.dueDate) L.para(`Dieses Angebot ist gültig bis zum ${fmtDate(d.dueDate)}.`, { gap: 6 });
  if (d.outro) L.para(d.outro, { gap: 6 });
  L.ensure(14 * MM);
  L.para("Mit freundlichen Grüßen", { gap: 0 });
  L.para(COMPANY.name, { bold: true });

  L.finishPageNumbers();
  if (d.number) await pdfA(doc, title, xml);
  return doc.save({ useObjectStreams: false });
}

export type DunningPdfData = {
  level: number;
  date: string;
  dueDate: string;
  buyer: Party;
  invoice: { number: string; date: string; dueDate: string | null; grossCents: number; paidCents: number };
  feeCents: number;
  config: DocData["config"];
};

export const DUNNING_LABEL = ["", "Zahlungserinnerung", "1. Mahnung", "2. Mahnung"];

export function dunningText(level: number, invoiceNo: string, due: string) {
  if (level <= 1)
    return `sicher ist es Ihrer Aufmerksamkeit entgangen: Für die Rechnung ${invoiceNo} konnten wir bisher keinen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag bis zum ${fmtDate(due)}. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.`;
  if (level === 2)
    return `leider konnten wir zu unserer Rechnung ${invoiceNo} trotz Zahlungserinnerung noch keinen Zahlungseingang feststellen. Bitte überweisen Sie den unten genannten Betrag einschließlich Mahngebühr bis zum ${fmtDate(due)}.`;
  return `trotz Zahlungserinnerung und Mahnung ist unsere Rechnung ${invoiceNo} weiterhin offen. Wir bitten Sie dringend, den unten genannten Betrag bis zum ${fmtDate(due)} zu überweisen. Andernfalls sehen wir uns gezwungen, ohne weitere Ankündigung gerichtliche Schritte einzuleiten. Wir weisen auf die gesetzlichen Verzugszinsen (§ 288 BGB) hin.`;
}

/** Zahlungserinnerung / Mahnung als PDF/A */
export async function renderDunningPdf(d: DunningPdfData): Promise<Uint8Array> {
  const label = DUNNING_LABEL[Math.min(Math.max(d.level, 1), 3)];
  const title = `${label} zu Rechnung ${d.invoice.number}`;
  const { doc, letter: L } = await newDoc(title, { headerLabel: title, bank: d.config, draft: false });
  L.newPage(true);
  const info: [string, string][] = [["Datum", fmtDate(d.date)]];
  if (d.buyer.customerNo) info.push(["Kundennummer", String(d.buyer.customerNo)]);
  info.push(["Rechnungsnummer", d.invoice.number]);
  L.head(d.buyer, info);
  L.text(title, LEFT, L.y - 14, { size: 15, bold: true, color: BRAND });
  L.y -= 28;
  L.para(d.buyer.greeting || "Sehr geehrte Damen und Herren,", { gap: 4 });
  L.para(dunningText(d.level, d.invoice.number, d.dueDate), { gap: 10 });

  const open = d.invoice.grossCents - d.invoice.paidCents;
  const rows: [string, string][] = [
    [`Rechnung ${d.invoice.number} vom ${fmtDate(d.invoice.date)}${d.invoice.dueDate ? `, fällig ${fmtDate(d.invoice.dueDate)}` : ""}`, fmtEuroCents(d.invoice.grossCents)],
  ];
  if (d.invoice.paidCents) rows.push(["bereits bezahlt", `− ${fmtEuroCents(d.invoice.paidCents)}`]);
  if (d.feeCents) rows.push(["Mahngebühr", fmtEuroCents(d.feeCents)]);
  for (const [k, v] of rows) {
    L.text(k, LEFT, L.y - 10, { size: 9.5 });
    L.text(v, RIGHT, L.y - 10, { size: 9.5, align: "right" });
    L.y -= 15;
    L.page.drawLine({ start: { x: LEFT, y: L.y + 2 }, end: { x: RIGHT, y: L.y + 2 }, thickness: 0.4, color: LINE });
  }
  L.page.drawRectangle({ x: RIGHT - 80 * MM, y: L.y - 9 * MM, width: 80 * MM, height: 7.5 * MM, color: BRAND });
  L.text("Zu zahlen", RIGHT - 78 * MM, L.y - 7 * MM, { size: 10, bold: true, color: rgb(1, 1, 1) });
  L.text(fmtEuroCents(open + d.feeCents), RIGHT - 2 * MM, L.y - 7 * MM, { size: 10, bold: true, color: rgb(1, 1, 1), align: "right" });
  L.y -= 16 * MM;
  L.para(`Bitte überweisen Sie bis zum ${fmtDate(d.dueDate)} auf unser Konto${d.config.iban ? ` IBAN ${fmtIban(d.config.iban)}${d.config.bic ? `, BIC ${d.config.bic}` : ""}${d.config.bankName ? ` (${d.config.bankName})` : ""}` : ""} – Verwendungszweck: ${d.invoice.number}.`, { gap: 10 });
  L.para("Mit freundlichen Grüßen", { gap: 0 });
  L.para(COMPANY.name, { bold: true });
  L.finishPageNumbers();
  await pdfA(doc, title, null);
  return doc.save({ useObjectStreams: false });
}
