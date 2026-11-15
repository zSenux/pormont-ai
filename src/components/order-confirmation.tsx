"use client";

import { Send } from "lucide-react";
import { StateForm } from "@/components/state-form";
import { sendConfirmationAction } from "@/app/actions/auftraege";

/** Mail-Formular „Auftragsbestätigung senden“ (Text vorbelegt, PDF hängt automatisch an) */
export function SendConfirmationForm({ orderId, d }: { orderId: string; d: { an: string; betreff: string; text: string } }) {
  return (
    <StateForm action={sendConfirmationAction.bind(null, orderId)} submit={<><Send className="size-4" /> Auftragsbestätigung senden</>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-steel">An<input name="an" type="email" multiple defaultValue={d.an} required className="input mt-0.5" /></label>
        <label className="text-xs text-steel">CC (optional)<input name="cc" type="email" multiple className="input mt-0.5" /></label>
      </div>
      <label className="block text-xs text-steel">Betreff<input name="betreff" defaultValue={d.betreff} required maxLength={300} className="input mt-0.5" /></label>
      <label className="block text-xs text-steel">Text<textarea name="text" defaultValue={d.text} rows={8} required className="input mt-0.5 resize-y" /></label>
      <p className="text-xs text-steel">Die Auftragsbestätigung hängt als PDF an. Die Mail geht vom Firmenpostfach raus und liegt danach im Ordner „Gesendet“.</p>
    </StateForm>
  );
}
