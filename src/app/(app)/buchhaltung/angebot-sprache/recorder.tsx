"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Mic, Square, Wand2 } from "lucide-react";
import { clsx } from "clsx";
import { voiceQuote, type VoiceQuoteResult } from "@/app/actions/angebot-sprache";

type Rec = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; start(): void; stop(): void };

const EXAMPLE = "Angebot für Familie Schneider, Bergstraße 88 in Weinheim. Schiebetor freitragend 5,5 Meter, Füllung Flachstahl senkrecht, feuerverzinkt und pulverbeschichtet RAL 7016, 6.450 Euro. Torantrieb Sommer mit zwei Handsendern 1.180 Euro. Fundament und Montage pauschal 1.350 Euro.";
const euro = (c: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(c / 100);

/** Diktat aufnehmen (Web Speech API, läuft weiter bis „Stopp“) → Angebots-Entwurf */
export function VoiceQuoteRecorder({ projectId }: { projectId?: string }) {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<VoiceQuoteResult | null>(null);
  const [pending, start] = useTransition();
  const rec = useRef<Rec | null>(null);
  const want = useRef(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const W = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(Boolean(W.SpeechRecognition || W.webkitSpeechRecognition));
    return () => {
      want.current = false;
      rec.current?.stop();
    };
  }, []);

  function begin() {
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return setErr("Spracherkennung geht in Safari (iPhone), Chrome und Edge.");
    setErr(null);
    setRes(null);
    want.current = true;
    const r = new Ctor();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let fin = "", mid = "";
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (mid += e.results[i][0].transcript));
      if (fin.trim()) setText((t) => (t ? `${t.trim()} ${fin.trim()}` : fin.trim()));
      setInterim(mid);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") (want.current = false), setErr("Mikrofon ist nicht freigegeben (Einstellungen → Safari/Browser → Mikrofon).");
    };
    // Safari beendet nach Sprechpausen – solange „Aufnahme“ läuft, neu starten
    r.onend = () => {
      setInterim("");
      if (want.current) {
        try {
          r.start();
          return;
        } catch {}
      }
      setOn(false);
    };
    rec.current = r;
    r.start();
    setOn(true);
  }
  function stop() {
    want.current = false;
    rec.current?.stop();
    setOn(false);
  }
  function create() {
    stop();
    start(async () => setRes(await voiceQuote(text, projectId)));
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-5">
        <div className="flex flex-col items-center gap-3 py-2">
          <button type="button" onClick={on ? stop : begin} disabled={!supported || pending} className={clsx("grid size-24 place-items-center rounded-full text-white shadow-lg transition", on ? "animate-pulse bg-bad" : "bg-brand hover:bg-brand-2", !supported && "opacity-40")} aria-label={on ? "Aufnahme stoppen" : "Aufnahme starten"}>
            {on ? <Square className="size-9" /> : <Mic className="size-10" />}
          </button>
          <p className="text-sm font-medium">{on ? "Ich höre zu … sprich ganz normal. Zum Beenden tippen." : supported ? "Tippen und sprechen" : "Spracherkennung wird hier nicht unterstützt – Text eintippen geht auch."}</p>
        </div>
        <textarea value={text + (interim ? ` ${interim}` : "")} onChange={(e) => setText(e.target.value)} rows={7} className="input resize-y" placeholder={`Zum Beispiel: „${EXAMPLE}“`} aria-label="Diktat" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={create} disabled={pending || text.trim().length < 10} className="btn-primary">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} {pending ? "Jarvis schreibt das Angebot …" : "Angebot erstellen"}
          </button>
          {text && !pending && <button type="button" onClick={() => (setText(""), setRes(null))} className="btn-secondary">Neu anfangen</button>}
          {!text && <button type="button" onClick={() => setText(EXAMPLE)} className="text-xs font-medium text-brand">Beispiel einsetzen</button>}
        </div>
        {err && <p className="text-sm text-bad">{err}</p>}
      </section>

      {res?.error && <p className="card flex items-start gap-2 border-red-200 p-4 text-sm text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {res.error}</p>}
      {res?.docId && (
        <section className="card space-y-3 border-brand/40 p-5">
          <p className="flex items-center gap-2 font-semibold text-ok"><CheckCircle2 className="size-5" /> Angebots-Entwurf ist fertig</p>
          <p className="text-sm">
            {res.customer ? <>Kunde: <strong>{res.customer}</strong>{res.customerCreated && " (neu angelegt)"}</> : "Ohne Kunde"} · {res.lines} Positionen · <strong>{euro(res.netCents ?? 0)}</strong> netto / {euro(res.grossCents ?? 0)} brutto
          </p>
          {res.questions && res.questions.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-warn">
              <p className="font-semibold">Bitte prüfen:</p>
              <ul className="list-disc pl-5">{res.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/buchhaltung/beleg/${res.docId}`} className="btn-primary"><FileText className="size-4" /> Entwurf ansehen & bearbeiten</Link>
            <a href={`/api/buchhaltung/pdf/${res.docId}`} target="_blank" rel="noreferrer" className="btn-secondary">PDF-Vorschau</a>
          </div>
          <p className="text-xs text-steel">Noch ein Entwurf ohne Nummer. Festschreiben und Senden machst du wie immer im Beleg.</p>
        </section>
      )}
    </div>
  );
}
