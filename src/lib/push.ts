import "server-only";
import * as webpush from "web-push";
import { db } from "@/lib/db";

// Web-Push (VAPID). Schlüssel einmalig erzeugen: `npx web-push generate-vapid-keys`
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT – Schlüssel nie wechseln (sonst verlieren alle Geräte ihr Abo).

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function setup() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:info@promont.gmbh", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string; userId?: string };

/** An alle (oder die Geräte eines Nutzers) senden. Fehler werden geloggt, nie geworfen. */
export async function sendPush(message: PushMessage) {
  if (!pushConfigured()) return 0;
  try {
    setup();
    const subs = await db.pushSubscription.findMany(message.userId ? { where: { userId: message.userId } } : undefined);
    const { userId: _u, ...msg } = message;
    const payload = JSON.stringify(msg);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: "high" });
          sent++;
          await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          else console.warn(`[push] ${s.device ?? s.id}: ${status ?? ""} ${(e as Error).message}`);
        }
      }),
    );
    return sent;
  } catch (e) {
    console.error("[push]", e);
    return 0;
  }
}
