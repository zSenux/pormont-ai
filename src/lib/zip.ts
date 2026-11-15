import "server-only";
import { crc32, deflateRawSync } from "node:zlib";

// Kleiner ZIP-Schreiber (Deflate, UTF-8-Dateinamen) – reicht für Monatsablagen und braucht kein Zusatzpaket.

export type ZipEntry = { name: string; data: Uint8Array; date?: Date };

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Doppelte Namen bekommen „ (2)“, „ (3)“ … */
function uniqueNames(entries: ZipEntry[]) {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const n = (seen.get(e.name.toLowerCase()) ?? 0) + 1;
    seen.set(e.name.toLowerCase(), n);
    if (n === 1) return e.name;
    const dot = e.name.lastIndexOf(".");
    return dot > e.name.lastIndexOf("/") ? `${e.name.slice(0, dot)} (${n})${e.name.slice(dot)}` : `${e.name} (${n})`;
  });
}

export function zip(entries: ZipEntry[]): Buffer {
  const names = uniqueNames(entries);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const name = Buffer.from(names[i], "utf8");
    const raw = Buffer.from(e.data);
    const packed = deflateRawSync(raw);
    const stored = packed.length >= raw.length;
    const body = stored ? raw : packed;
    const crc = crc32(raw) >>> 0;
    const { time, date } = dosTime(e.date ?? new Date());
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8
    h.writeUInt16LE(stored ? 0 : 8, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    local.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + body.length;
  });
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

/** Dateiname ohne Pfad-/Sonderzeichen */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "Datei";
