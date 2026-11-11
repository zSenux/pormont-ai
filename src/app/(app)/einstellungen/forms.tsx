"use client";

import { useActionState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { addUser, changePassword, deleteMemory, removeUser } from "@/app/actions";

function Msg({ s }: { s?: { ok?: string; error?: string } }) {
  if (s?.error) return <p className="text-sm text-bad" role="alert">{s.error}</p>;
  if (s?.ok) return <p className="text-sm text-ok">{s.ok}</p>;
  return null;
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-3">
      <input name="alt" type="password" autoComplete="current-password" required placeholder="Aktuelles Passwort" className="input" aria-label="Aktuelles Passwort" />
      <input name="neu" type="password" autoComplete="new-password" required minLength={10} placeholder="Neues Passwort (mind. 10 Zeichen)" className="input" aria-label="Neues Passwort" />
      <Msg s={state} />
      <button className="btn-secondary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Passwort ändern</button>
    </form>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState(addUser, undefined);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input name="name" required placeholder="Name" className="input" aria-label="Name" />
      <input name="email" type="email" required placeholder="E-Mail" className="input" aria-label="E-Mail" />
      <input name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="Start-Passwort" className="input" aria-label="Start-Passwort" />
      <select name="role" className="input" aria-label="Rolle" defaultValue="MEMBER">
        <option value="MEMBER">Mitarbeiter</option>
        <option value="ADMIN">Administrator</option>
      </select>
      <div className="sm:col-span-2 space-y-2">
        <Msg s={state} />
        <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Benutzer anlegen</button>
      </div>
    </form>
  );
}

export function DeleteButton({ kind, id, label }: { kind: "user" | "memory"; id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (kind === "user" && !confirm(`${label} wirklich entfernen?`)) return;
        start(() => (kind === "user" ? removeUser(id) : deleteMemory(id)));
      }}
      className="rounded-full p-1.5 text-steel hover:bg-red-50 hover:text-bad"
      aria-label={`${label} entfernen`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}
