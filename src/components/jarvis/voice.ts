"use client";

// Sprache im Browser (wie in Klaic OS): Web Speech API für Diktat (de-DE) und Vorlesen.
// Läuft in Chrome/Edge (auch Windows-App) und Safari (iPhone, auch als Home-Bildschirm-App).

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export function speechSupported() {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
}

/** Einmal zuhören; liefert den Text nach einer Sprechpause */
export function listen(opts: { onInterim?: (t: string) => void; onFinal: (t: string) => void; onEnd?: () => void; onError?: (msg: string) => void }) {
  const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!Ctor) {
    opts.onError?.("Spracherkennung wird von diesem Browser nicht unterstützt.");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = "de-DE";
  rec.continuous = false;
  rec.interimResults = true;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onInterim?.((finalText + " " + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    opts.onError?.(e.error === "not-allowed" ? "Mikrofon ist nicht freigegeben." : `Spracherkennung: ${e.error}`);
  };
  rec.onend = () => {
    if (finalText.trim()) opts.onFinal(finalText.trim());
    opts.onEnd?.();
  };
  rec.start();
  return () => rec.stop();
}

function germanVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const de = voices.filter((v) => v.lang?.toLowerCase().startsWith("de"));
  return de.find((v) => /premium|enhanced|natural|neural|online/i.test(v.name)) ?? de.find((v) => /google|microsoft/i.test(v.name)) ?? de[0] ?? null;
}

/** Vorlesen; Promise endet, wenn fertig gesprochen (oder abgebrochen) */
export function speak(text: string) {
  return new Promise<void>((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || !text.trim()) return resolve();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    const v = germanVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

export function speakable(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>|]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
