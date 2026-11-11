"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";

type Result = { ok?: string; error?: string } | undefined;

/** Formular mit Server-Action, die { ok | error } zurückgibt – zeigt Meldung und Ladezustand */
export function StateForm({
  action,
  children,
  submit,
  className = "space-y-3",
  submitClass = "btn-primary",
  reset = false,
  onOk,
}: {
  action: (prev: Result, form: FormData) => Promise<Result>;
  children: ReactNode;
  submit: ReactNode;
  className?: string;
  submitClass?: string;
  reset?: boolean;
  onOk?: () => void;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      onOk?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={submitClass} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {submit}
        </button>
        {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
        {state?.ok && <p className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> {state.ok}</p>}
      </div>
    </form>
  );
}
