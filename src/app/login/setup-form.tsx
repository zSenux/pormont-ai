"use client";

import { useActionState } from "react";
import { Loader2, Rocket } from "lucide-react";
import { setupAdmin } from "@/app/actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAdmin, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="code">Einrichtungs-Code</label>
        <input id="code" name="code" required autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" className="input font-mono tracking-wider" />
        <p className="mt-1 text-xs text-steel">Bekommst du von Klaic Media.</p>
      </div>
      <div>
        <label className="label" htmlFor="name">Dein Name</label>
        <input id="name" name="name" required autoComplete="name" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="email">E-Mail (dein Login)</label>
        <input id="email" name="email" type="email" required autoComplete="username" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Passwort (mind. 10 Zeichen)</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      <button className="btn-primary w-full !py-2.5" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Jarvis einrichten
      </button>
    </form>
  );
}
