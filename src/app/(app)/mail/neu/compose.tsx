"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Save, Send, X } from "lucide-react";
import { sendMailAction } from "@/app/actions/mail";

type Init = { an: string; cc: string; betreff: string; text: string };

export function Compose({ init, reply, forward, originalAttachments }: { init: Init; reply: string | null; forward: string | null; originalAttachments: number }) {
  const [state, action, pending] = useActionState(sendMailAction, undefined);
  const [showCc, setShowCc] = useState(Boolean(init.cc));
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Cursor bei Antwort/Weiterleitung oben vor das Zitat setzen
  useEffect(() => {
    const t = text.current;
    if (t && init.an) {
      t.focus();
      t.setSelectionRange(0, 0);
      t.scrollTop = 0;
    }
  }, [init.an]);

  // nach dem Senden zurück in den Posteingang
  useEffect(() => {
    if (state?.sent) {
      const id = setTimeout(() => router.push("/mail?gesendet=1"), 900);
      return () => clearTimeout(id);
    }
  }, [state, router]);

  // ausgewählte Dateien ins Formular übernehmen
  useEffect(() => {
    if (!fileInput.current) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    fileInput.current.files = dt.files;
  }, [files]);

  const size = files.reduce((s, f) => s + f.size, 0);
  return (
    <form action={action} className="card space-y-3 p-4 md:p-5">
      {reply && <input type="hidden" name="antwort" value={reply} />}
      {forward && <input type="hidden" name="weiter" value={forward} />}
      <div className="flex items-center gap-2">
        <label htmlFor="an" className="w-14 shrink-0 text-sm text-steel">An</label>
        <input id="an" name="an" defaultValue={init.an} required className="input min-w-0 flex-1" placeholder="name@firma.de, weitere mit Komma" autoComplete="email" />
        {!showCc && (
          <button type="button" className="text-sm font-medium text-brand" onClick={() => setShowCc(true)}>
            CC
          </button>
        )}
      </div>
      {showCc && (
        <div className="flex items-center gap-2">
          <label htmlFor="cc" className="w-14 shrink-0 text-sm text-steel">CC</label>
          <input id="cc" name="cc" defaultValue={init.cc} className="input min-w-0 flex-1" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor="betreff" className="w-14 shrink-0 text-sm text-steel">Betreff</label>
        <input id="betreff" name="betreff" defaultValue={init.betreff} required maxLength={250} className="input min-w-0 flex-1" />
      </div>
      <textarea ref={text} name="text" defaultValue={init.text} required rows={16} className="input w-full resize-y text-[15px] leading-relaxed" aria-label="Nachricht" />

      <div className="space-y-2">
        <input ref={fileInput} type="file" name="anhang" multiple className="hidden" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 10))} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
            <Paperclip className="size-4" /> Anhang
          </button>
          {files.map((f, i) => (
            <span key={i} className="chip gap-1 bg-mist px-3 py-1 text-ink">
              {f.name} <span className="text-steel">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
              <button type="button" aria-label={`${f.name} entfernen`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
        {size > 9 * 1024 * 1024 && <p className="text-sm text-bad">Die Anhänge sind zusammen größer als 9 MB.</p>}
        {originalAttachments > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="originalAnhaenge" value="1" defaultChecked /> {originalAttachments} {originalAttachments === 1 ? "Anhang" : "Anhänge"} der Original-Mail mitsenden
          </label>
        )}
      </div>

      {state?.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-bad">{state.error}</p>}
      {state?.ok && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{state.ok}</p>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <button className="btn-primary" name="modus" value="senden" disabled={pending || state?.sent}>
          <Send className="size-4" /> {pending ? "Wird gesendet …" : "Senden"}
        </button>
        <button className="btn-secondary" name="modus" value="entwurf" disabled={pending || state?.sent} formNoValidate>
          <Save className="size-4" /> Als Entwurf speichern
        </button>
      </div>
    </form>
  );
}
