"use client";

import { useActionState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { login } from "@/app/actions";

export function LoginForm({ weiter }: { weiter?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="weiter" value={weiter ?? ""} />
      <div>
        <label className="label" htmlFor="email">E-Mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Passwort</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      <button className="btn-primary w-full !py-2.5" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Anmelden
      </button>
    </form>
  );
}
