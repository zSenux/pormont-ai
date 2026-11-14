import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { berlinDateTime } from "@/lib/berlin";
import { addPayment, BookError, deletePayment, openCentsOf, ymdOf, type Actor } from "./docs";
import { setPurchasePaid } from "./purchases";

// Bankabgleich: Kontoauszug (CAMT.053 als XML oder CSV-Export der Bank) hochladen → Umsätze landen als BankTx.
// Jarvis schlägt passende Rechnungen/Ausgaben vor (Rechnungsnummer im Verwendungszweck, Betrag + Name).
// Zugeordnet wird nur per Klick (einzeln oder „alle sicheren“). Auszug-Inhalte sind fremde Daten.

export type ParsedTx = { day: string; amountCents: number; name: string | null; iban: string | null; purpose: string | null };

const MAX_TX = 5000;

// ---------- Einlesen ----------

function decode(buf: Buffer) {
  const utf = buf.toString("utf8");
  return utf.includes("�") ? buf.toString("latin1") : utf.replace(/^﻿/, "");
}

const tag = (xml: string, path: string[]) => {
  let cur: string | null = xml;
  for (const t of path) {
    if (cur === null) return null;
    const m: RegExpExecArray | null = new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`).exec(cur);
    cur = m ? m[1] : null;
  }
  return cur;
};
const unxml = (s: string | null) => (s === null ? null : s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim() || null);

/** CAMT.053 (Kontoauszug als XML, bieten alle deutschen Banken an) */
function parseCamt(xml: string): ParsedTx[] {
  const out: ParsedTx[] = [];
  const entries = xml.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) ?? [];
  for (const e of entries) {
    const sts = unxml(tag(e, ["Sts", "Cd"])) ?? unxml(tag(e, ["Sts"]));
    if (sts && !/BOOK/i.test(sts)) continue;
    const amt = Number(unxml(tag(e, ["Amt"])));
    if (!Number.isFinite(amt)) continue;
    const credit = /CRDT/.test(unxml(tag(e, ["CdtDbtInd"])) ?? "");
    const day = unxml(tag(e, ["BookgDt", "Dt"])) ?? unxml(tag(e, ["BookgDt", "DtTm"]))?.slice(0, 10) ?? unxml(tag(e, ["ValDt", "Dt"]));
    if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) continue;
    const party = credit ? "Dbtr" : "Cdtr";
    const name = unxml(tag(e, ["RltdPties", party, "Nm"])) ?? unxml(tag(e, ["RltdPties", party, "Pty", "Nm"]));
    const iban = unxml(tag(e, ["RltdPties", `${party}Acct`, "Id", "IBAN"]));
    const ustrd = [...(tag(e, ["RmtInf"]) ?? "").matchAll(/<(?:\w+:)?Ustrd>([\s\S]*?)<\/(?:\w+:)?Ustrd>/g)].map((m) => unxml(m[1])).filter(Boolean).join(" ");
    const purpose = ustrd || unxml(tag(e, ["AddtlNtryInf"]));
    out.push({ day: day.slice(0, 10), amountCents: Math.round(amt * 100) * (credit ? 1 : -1), name, iban, purpose });
  }
  return out;
}

function splitCsv(line: string, sep: string) {
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) cells.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const parseDay = (s: string) => {
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s.trim());
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const parseAmount = (s: string) => {
  const t = s.replace(/\s|€|EUR/g, "");
  if (!t) return NaN;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

/** CSV-Export der Bank (Sparkasse, Volksbank, Commerzbank, Deutsche Bank, ING, DKB …) – Spalten werden erkannt */
function parseCsv(text: string): ParsedTx[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines.slice(0, 20).join("\n").match(/;/g)?.length ?? 0) >= (lines.slice(0, 20).join("\n").match(/,/g)?.length ?? 0) / 2 ? ";" : ",";
  const norm = (h: string) => h.toLowerCase().replace(/[^a-zäöüß/]/g, "");
  const hi = lines.findIndex((l) => {
    const h = splitCsv(l, sep).map(norm);
    return h.some((x) => /betrag|umsatz/.test(x)) && h.some((x) => /buchungstag|buchungsdatum|^datum|valuta|wertstellung/.test(x));
  });
  if (hi < 0) throw new BookError("Spalten nicht erkannt. Bitte den Kontoauszug als CAMT (XML) oder CSV mit den Spalten Buchungstag und Betrag exportieren.");
  const head = splitCsv(lines[hi], sep).map(norm);
  const find = (...re: RegExp[]) => {
    for (const r of re) {
      const i = head.findIndex((h) => r.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cDay = find(/^buchungstag$/, /buchungsdatum/, /^datum$/, /buchungstag/, /valuta|wertstellung/);
  const cAmt = find(/^betrag$/, /^betrag/, /umsatz/, /betrag/);
  const cName = find(/beguenstigter|begünstigter|zahlungspflichtig/, /namezahlungsbeteiligter/, /zahlungsempfänger|empfänger|auftraggeber/, /^name/);
  const cIban = find(/^iban/, /ibanzahlungsbeteiligter/, /kontonummer\/iban|kontonummer/);
  const cPurpose = find(/verwendungszweck/, /buchungstext/, /vorgang/);
  const cSh = find(/^soll\/haben$|^sh$|sollhaben/);
  const out: ParsedTx[] = [];
  for (const l of lines.slice(hi + 1)) {
    const c = splitCsv(l, sep);
    const day = cDay >= 0 ? parseDay(c[cDay] ?? "") : null;
    let amt = cAmt >= 0 ? parseAmount(c[cAmt] ?? "") : NaN;
    if (!day || Number.isNaN(amt)) continue;
    if (cSh >= 0 && /^s/i.test(c[cSh] ?? "") && amt > 0) amt = -amt;
    out.push({ day, amountCents: amt, name: (cName >= 0 && c[cName]) || null, iban: (cIban >= 0 && c[cIban]?.replace(/\s/g, "")) || null, purpose: (cPurpose >= 0 && c[cPurpose]) || null });
  }
  return out;
}

export function parseStatement(buf: Buffer): ParsedTx[] {
  const text = decode(buf);
  const list = /<(?:\w+:)?BkToCstmrStmt|<(?:\w+:)?Ntry>/.test(text) ? parseCamt(text) : parseCsv(text);
  if (!list.length) throw new BookError("Im Kontoauszug wurden keine Umsätze gefunden.");
  if (list.length > MAX_TX) throw new BookError(`Zu viele Umsätze (${list.length}) – bitte kürzeren Zeitraum exportieren.`);
  return list;
}

/** Umsätze speichern; schon importierte (gleicher Tag, Betrag, Name, Zweck) werden übersprungen */
export async function importStatement(buf: Buffer, fileName: string, user: Actor) {
  const list = parseStatement(buf);
  const seen = new Map<string, number>();
  const rows = list.map((t) => {
    const key = [t.day, t.amountCents, t.iban ?? "", (t.name ?? "").toLowerCase(), (t.purpose ?? "").toLowerCase().replace(/\s+/g, " ")].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return {
      hash: createHash("sha256").update(`${key}|${n}`).digest("hex"),
      day: berlinDateTime(t.day),
      amountCents: t.amountCents,
      name: t.name?.slice(0, 200) ?? null,
      iban: t.iban?.slice(0, 40) ?? null,
      purpose: t.purpose?.slice(0, 500) ?? null,
      fileName: fileName.slice(0, 200),
      importedBy: user.name,
    };
  });
  const r = await db.bankTx.createMany({ data: rows, skipDuplicates: true });
  return { total: rows.length, added: r.count };
}

// ---------- Vorschläge ----------

export type Suggestion = { kind: "doc" | "purchase"; id: string; label: string; sure: boolean };

const words = (s: string | null) => (s ?? "").toLowerCase().replace(/gmbh|co\.?|kg|ag|e\.k\.|mbh|&/g, " ").split(/[^a-zäöüß0-9]+/).filter((w) => w.length >= 4);
const nameHit = (a: string | null, b: string | null) => {
  const wa = new Set(words(a));
  return words(b).some((w) => wa.has(w));
};
const compact = (s: string | null) => (s ?? "").toUpperCase().replace(/\s+/g, "");

export async function suggestions(txs: { id: string; amountCents: number; name: string | null; purpose: string | null }[]) {
  const [docs, purchases] = await Promise.all([
    db.salesDoc.findMany({ where: { kind: "RECHNUNG", status: "OFFEN" }, include: { customer: { select: { name: true } } } }),
    db.purchaseDoc.findMany({ where: { status: "OFFEN" } }),
  ]);
  const res = new Map<string, Suggestion>();
  for (const t of txs) {
    const purpose = compact(t.purpose);
    if (t.amountCents > 0) {
      // 1. Rechnungsnummer im Verwendungszweck
      const byNo = docs.filter((d) => d.number && purpose.includes(d.number.replace(/\s+/g, "")));
      if (byNo.length === 1) {
        const d = byNo[0];
        const open = openCentsOf(d);
        res.set(t.id, { kind: "doc", id: d.id, label: `${d.number} · ${d.customer?.name ?? ""} · offen ${(open / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}`, sure: t.amountCents <= open + 100 });
        continue;
      }
      // 2. gleicher offener Betrag (+ Name passt)
      const byAmt = docs.filter((d) => openCentsOf(d) === t.amountCents);
      const named = byAmt.filter((d) => nameHit(d.customer?.name ?? null, `${t.name ?? ""} ${t.purpose ?? ""}`));
      const pick = named.length === 1 ? named[0] : byAmt.length === 1 ? byAmt[0] : null;
      if (pick) res.set(t.id, { kind: "doc", id: pick.id, label: `${pick.number} · ${pick.customer?.name ?? ""}`, sure: named.length === 1 });
    } else if (t.amountCents < 0) {
      const amt = -t.amountCents;
      const byNo = purchases.filter((p) => p.docNo && p.docNo.length >= 4 && purpose.includes(compact(p.docNo)));
      const byAmt = purchases.filter((p) => p.grossCents === amt);
      const named = byAmt.filter((p) => nameHit(p.supplier, `${t.name ?? ""} ${t.purpose ?? ""}`));
      const pick = byNo.length === 1 ? byNo[0] : named.length === 1 ? named[0] : byAmt.length === 1 ? byAmt[0] : null;
      if (pick) res.set(t.id, { kind: "purchase", id: pick.id, label: `${pick.number} · ${pick.supplier}${pick.docNo ? ` (${pick.docNo})` : ""}`, sure: (byNo.length === 1 && pick.grossCents === amt) || named.length === 1 });
    }
  }
  return res;
}

// ---------- Zuordnen ----------

export async function assignTx(txId: string, target: { kind: "doc" | "purchase"; id: string }, user: Actor) {
  const tx = await db.bankTx.findUnique({ where: { id: txId } });
  if (!tx) throw new BookError("Umsatz nicht gefunden.");
  // Atomar beanspruchen: ein Umsatz wird nur einmal zugeordnet
  const claim = await db.bankTx.updateMany({ where: { id: txId, docId: null, purchaseId: null, ignored: false }, data: target.kind === "doc" ? { docId: target.id } : { purchaseId: target.id } });
  if (!claim.count) throw new BookError("Dieser Umsatz ist schon zugeordnet.");
  try {
    if (target.kind === "doc") {
      if (tx.amountCents <= 0) throw new BookError("Ein Zahlungsausgang kann keiner Rechnung zugeordnet werden.");
      await addPayment(target.id, { day: ymdOf(tx.day)!, amountCents: tx.amountCents, method: "UEBERWEISUNG", note: `Bank: ${[tx.name, tx.purpose].filter(Boolean).join(" · ").slice(0, 250)}` }, user);
      const p = await db.payment.findFirst({ where: { docId: target.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
      await db.bankTx.update({ where: { id: txId }, data: { paymentId: p?.id ?? null } });
    } else {
      if (tx.amountCents >= 0) throw new BookError("Ein Zahlungseingang kann keiner Ausgabe zugeordnet werden.");
      const p = await db.purchaseDoc.findUnique({ where: { id: target.id }, select: { status: true } });
      if (!p) throw new BookError("Ausgabe nicht gefunden.");
      await setPurchasePaid(target.id, true, "UEBERWEISUNG", tx.day);
    }
  } catch (e) {
    await db.bankTx.update({ where: { id: txId }, data: { docId: null, purchaseId: null, paymentId: null } });
    throw e;
  }
}

export async function unassignTx(txId: string, user: Actor) {
  const tx = await db.bankTx.findUnique({ where: { id: txId } });
  if (!tx) throw new BookError("Umsatz nicht gefunden.");
  if (tx.paymentId && (await db.payment.findUnique({ where: { id: tx.paymentId }, select: { id: true } }))) await deletePayment(tx.paymentId, user);
  if (tx.purchaseId) await setPurchasePaid(tx.purchaseId, false).catch(() => undefined);
  await db.bankTx.update({ where: { id: txId }, data: { docId: null, purchaseId: null, paymentId: null } });
}

export async function setIgnored(txId: string, ignored: boolean) {
  const r = await db.bankTx.updateMany({ where: { id: txId, docId: null, purchaseId: null }, data: { ignored } });
  if (!r.count) throw new BookError("Zugeordnete Umsätze bitte erst lösen.");
}

/** Alle sicheren Vorschläge zuordnen */
export async function autoAssign(user: Actor) {
  const open = await db.bankTx.findMany({ where: { docId: null, purchaseId: null, ignored: false }, orderBy: { day: "asc" }, take: 500 });
  const sug = await suggestions(open);
  let done = 0;
  const used = new Set<string>();
  for (const t of open) {
    const s = sug.get(t.id);
    if (!s?.sure || used.has(s.id)) continue;
    try {
      await assignTx(t.id, s, user);
      used.add(s.id);
      done++;
    } catch {}
  }
  return done;
}
