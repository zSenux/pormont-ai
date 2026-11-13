"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, History, Loader2, Mic, MicOff, Plus, Square, Volume2, VolumeX, Wrench } from "lucide-react";
import { clsx } from "clsx";
import { Markdown } from "@/components/markdown";
import { ActionCard, type ActionView } from "./action-card";
import { Reactor, reactorLabel, type ReactorState } from "./reactor";
import { listen, speak, speakable, speechSupported, stopSpeaking } from "./voice";

export type ChatMsg = { role: "user" | "assistant"; text: string; tools: string[] };

const TOOL_LABEL: Record<string, string> = {
  tagesueberblick: "Tagesüberblick",
  firmendaten: "Firmendaten",
  lexware_status: "Lexware-Verbindung",
  kunden_suchen: "Kunden suchen",
  kunde_details: "Kundendaten",
  belege: "Belege",
  beleg_details: "Beleg",
  umsatz: "Umsatz",
  artikel: "Artikel",
  kunde_anlegen: "Kunde anlegen",
  rechnung_erstellen: "Rechnung",
  angebot_erstellen: "Angebot",
  aufgaben: "Aufgaben",
  merken: "Merken",
  vergessen: "Vergessen",
};

const SUGGESTIONS = ["Was steht heute an?", "Welche Rechnungen sind überfällig?", "Wie viel Umsatz haben wir diesen Monat?", "Welche Angebote sind noch offen?", "Erinnere mich morgen um 9 Uhr an den Aufmaß-Termin"];

function source(): "web" | "windows" | "handy" {
  if (typeof navigator === "undefined") return "web";
  if (/JarvisPromont/i.test(navigator.userAgent)) return "windows";
  if (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone) return "handy";
  return "web";
}

export function JarvisChat(props: {
  userName: string;
  chatId: string | null;
  initialMessages: ChatMsg[];
  initialActions: ActionView[];
  recentChats: { id: string; title: string; updatedAt: string }[];
  autoQuery?: string;
  autoListen?: boolean;
  compact?: boolean;
}) {
  const [chatId, setChatId] = useState(props.chatId);
  const [messages, setMessages] = useState<ChatMsg[]>(props.initialMessages);
  const [actions, setActions] = useState<ActionView[]>(props.initialActions);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ReactorState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [voiceOut, setVoiceOut] = useState(false);
  const [talkMode, setTalkMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const talkRef = useRef(false);
  const autoDone = useRef(false);

  useEffect(() => {
    setCanListen(speechSupported());
    try {
      setVoiceOut(localStorage.getItem("jarvis-vorlesen") === "1");
    } catch {}
  }, []);

  // Beim Öffnen sofort ans Ende, danach weich mitscrollen
  const scrolled = useRef(false);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: scrolled.current ? "smooth" : "auto", block: "end" });
    scrolled.current = true;
  }, [messages, actions, interim]);

  const send = useCallback(
    async (text: string, viaVoice = false) => {
      const t = text.trim();
      if (!t || busy) return;
      setError(null);
      setInput("");
      setInterim("");
      setBusy(true);
      setState("thinking");
      setMessages((m) => [...m, { role: "user", text: t, tools: [] }, { role: "assistant", text: "", tools: [] }]);
      const speakIt = viaVoice || voiceOut;
      let reply = "";
      try {
        const res = await fetch("/api/jarvis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, text: t, voice: viaVoice, source: source() }) });
        if (res.status === 401) {
          window.location.href = "/login?weiter=/jarvis";
          return;
        }
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Jarvis ist gerade nicht erreichbar.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const event = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? "null");
            if (event === "chat") {
              setChatId(data.id);
              const url = new URL(window.location.href);
              url.searchParams.set("chat", data.id);
              url.searchParams.delete("q");
              url.searchParams.delete("sprechen");
              window.history.replaceState(null, "", url);
            } else if (event === "text") {
              reply += data.text;
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, text: last.text + data.text };
                return copy;
              });
            } else if (event === "tool") {
              // Windows-App: neuen Auftrag am PC sofort abholen
              if (data.name === "am_pc") (window as unknown as { jarvisDesktop?: { pcPoke?: () => void } }).jarvisDesktop?.pcPoke?.();
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, tools: [...last.tools, data.name] };
                return copy;
              });
            } else if (event === "action") {
              setActions((a) => (a.some((x) => x.id === data.id) ? a : [...a, data]));
            } else if (event === "error") {
              throw new Error(data.message);
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler.");
        setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].text ? m.slice(0, -1) : m));
      } finally {
        setBusy(false);
      }
      if (speakIt && reply.trim()) {
        setState("speaking");
        await speak(speakable(reply));
      }
      setState("idle");
      if (talkRef.current && reply.trim()) startListening();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [busy, chatId, voiceOut],
  );

  const startListening = useCallback(() => {
    stopSpeaking();
    setError(null);
    setState("listening");
    stopRef.current = listen({
      onInterim: setInterim,
      onFinal: (t) => {
        setInterim("");
        if (/^(danke|stopp|das war'?s|ende)\.?$/i.test(t)) {
          talkRef.current = false;
          setTalkMode(false);
          return;
        }
        void send(t, true);
      },
      onEnd: () => {
        stopRef.current = null;
        setState((s) => (s === "listening" ? "idle" : s));
      },
      onError: (msg) => {
        setError(msg);
        setState("idle");
        talkRef.current = false;
        setTalkMode(false);
      },
    });
  }, [send]);

  const toggleListen = () => {
    if (state === "listening") {
      stopRef.current?.();
      return;
    }
    if (state === "speaking") {
      stopSpeaking();
      setState("idle");
      return;
    }
    if (!busy) startListening();
  };

  useEffect(() => {
    if (autoDone.current) return;
    autoDone.current = true;
    if (props.autoQuery) void send(props.autoQuery);
    else if (props.autoListen && speechSupported()) startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base = props.compact ? "/fenster" : "/jarvis";
  const pending = actions.filter((a) => a.status === "PENDING").length;
  const empty = messages.length === 0;

  return (
    <div className={clsx("flex flex-col", props.compact ? "min-h-0 flex-1" : "min-h-[calc(100dvh-8rem)] md:min-h-[calc(100dvh-4rem)]")}>
      {/* Jarvis-Bühne */}
      <section className={clsx("relative overflow-hidden bg-gradient-to-b from-brand-2 to-brand text-white", props.compact ? "px-4 pt-3 pb-4" : "px-4 pt-6 pb-6 md:rounded-b-[28px]")}>
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(125,211,252,.25)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,.25)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative mx-auto flex max-w-3xl items-center gap-4">
          <Reactor state={state} size={props.compact ? 84 : empty ? 150 : 96} onClick={toggleListen} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-[0.2em] text-sky-200 uppercase">Jarvis · ProMont</p>
            <p className="truncate text-lg font-bold sm:text-xl">{state === "idle" ? (empty ? `Hallo ${props.userName}, was kann ich tun?` : "Bereit") : reactorLabel(state)}</p>
            {interim && <p className="mt-1 truncate text-sm text-sky-100">„{interim}“</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {canListen && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !talkMode;
                    setTalkMode(next);
                    talkRef.current = next;
                    if (next && state === "idle" && !busy) startListening();
                    if (!next) stopRef.current?.();
                  }}
                  className={clsx("chip border-white/30", talkMode ? "bg-white text-brand-2" : "bg-white/10 text-white")}
                >
                  {talkMode ? <Mic className="size-3" /> : <MicOff className="size-3" />} Gespräch {talkMode ? "an" : "aus"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const next = !voiceOut;
                  setVoiceOut(next);
                  if (!next) stopSpeaking();
                  try {
                    localStorage.setItem("jarvis-vorlesen", next ? "1" : "0");
                  } catch {}
                }}
                className={clsx("chip border-white/30", voiceOut ? "bg-white text-brand-2" : "bg-white/10 text-white")}
              >
                {voiceOut ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />} Vorlesen
              </button>
              <button type="button" onClick={() => setShowHistory((s) => !s)} className="chip border-white/30 bg-white/10 text-white">
                <History className="size-3" /> Verlauf
              </button>
              <Link href={`${base}?neu=1`} className="chip border-white/30 bg-white/10 text-white">
                <Plus className="size-3" /> Neu
              </Link>
            </div>
          </div>
        </div>
        {showHistory && (
          <div className="relative mx-auto mt-4 max-w-3xl rounded-2xl bg-white/10 p-2 backdrop-blur">
            {props.recentChats.length === 0 ? (
              <p className="p-2 text-sm text-sky-100">Noch keine Unterhaltungen.</p>
            ) : (
              <ul className="max-h-60 overflow-auto">
                {props.recentChats.map((c) => (
                  <li key={c.id}>
                    <Link href={`${base}?chat=${c.id}`} className={clsx("block truncate rounded-xl px-3 py-2 text-sm hover:bg-white/10", c.id === chatId && "bg-white/15 font-semibold")}>
                      {c.title} <span className="text-xs text-sky-200">· {new Date(c.updatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Verlauf */}
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5">
        {empty && (
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="card px-4 py-3 text-left text-sm font-medium text-ink transition hover:border-brand hover:text-brand">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-brand-2 text-[11px] font-bold text-sky-200">J</div>
              <div className="card min-w-0 flex-1 px-4 py-3 text-[15px] leading-relaxed">
                {m.tools.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {[...new Set(m.tools)].map((t) => (
                      <span key={t} className="chip border-line bg-mist text-steel">
                        <Wrench className="size-3" /> {TOOL_LABEL[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                {m.text ? <Markdown text={m.text} /> : busy && i === messages.length - 1 ? <Loader2 className="size-4 animate-spin text-steel" /> : null}
              </div>
            </div>
          ),
        )}
        {actions.length > 0 && (
          <div className="space-y-3">
            {actions.map((a) => (
              <ActionCard key={a.id} action={a} onDone={(n) => setActions((list) => list.map((x) => (x.id === n.id ? n : x)))} />
            ))}
          </div>
        )}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-bad">{error}</p>}
        <div ref={bottom} className="h-4 scroll-mb-28" />
      </div>

      {/* Eingabe */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className={clsx("sticky z-20 border-t border-line bg-white/95 px-3 py-3 backdrop-blur", props.compact ? "bottom-0" : "bottom-16 md:bottom-0")}
      >
        {pending > 0 && <p className="mx-auto mb-2 max-w-3xl text-xs font-medium text-warn">{pending === 1 ? "1 Freigabe wartet" : `${pending} Freigaben warten`} – oben auf „Freigeben“ tippen.</p>}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {canListen && (
            <button type="button" onClick={toggleListen} className={clsx("grid size-11 shrink-0 place-items-center rounded-full border transition", state === "listening" ? "border-red-300 bg-red-50 text-bad" : "border-line bg-white text-brand hover:border-brand")} aria-label={state === "listening" ? "Zuhören beenden" : "Sprechen"}>
              {state === "listening" ? <Square className="size-4" /> : <Mic className="size-5" />}
            </button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Frag Jarvis … z. B. „Angebot für Geländer bei Müller GmbH“"
            className="input max-h-40 min-h-11 resize-none"
            aria-label="Nachricht an Jarvis"
          />
          <button type="submit" disabled={busy || !input.trim()} className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-brand-2 disabled:opacity-40" aria-label="Senden">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      </form>
    </div>
  );
}
