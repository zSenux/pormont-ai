import "server-only";
import { db } from "@/lib/db";
import { transcript } from "./agent";
import type { ActionView } from "@/components/jarvis/action-card";

/** Daten für die Chat-Ansicht: gewählte (oder neueste) Unterhaltung, ihre Freigaben, Liste der letzten */
export async function loadChat(userId: string, chatParam: string | undefined, fresh: boolean) {
  const recent = await db.chat.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, updatedAt: true } });
  let chat = null;
  if (chatParam) chat = await db.chat.findFirst({ where: { id: chatParam, userId } });
  else if (!fresh && recent[0] && Date.now() - recent[0].updatedAt.getTime() < 6 * 3600_000) chat = await db.chat.findUnique({ where: { id: recent[0].id } });
  const actions = chat ? await db.pendingAction.findMany({ where: { chatId: chat.id }, orderBy: { createdAt: "asc" } }) : [];
  return {
    chatId: chat?.id ?? null,
    messages: chat ? transcript(chat.messages) : [],
    actions: actions.map((a): ActionView => ({ id: a.id, kind: a.kind, summary: a.summary, status: a.status, result: a.result, links: (a.links as ActionView["links"]) ?? null })),
    recent: recent.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
  };
}
