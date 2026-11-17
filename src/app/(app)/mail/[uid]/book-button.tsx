"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { bookMailInvoiceAction } from "@/app/actions/ausgaben";

type Res = { status: string; text: string; purchaseId?: string };

/** „Rechnung als Ausgabe buchen“: liest die PDF-Anhänge aus und bucht sie (Doppelte werden erkannt) */
export function BookInvoiceButton({ uid }: { uid: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Res[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await bookMailInvoiceAction(uid);
            if (r.error) setErr(r.error);
            setRes(r.results ?? null);
          })
        }
      >
        <Receipt className="size-4" /> {pending ? "Liest Rechnung aus …" : "Rechnung als Ausgabe buchen"}
      </button>
      {(res || err) && (
        <div className="basis-full space-y-1 rounded-xl bg-brand-soft p-3 text-sm">
          {err && <p className="text-bad">{err}</p>}
          {res?.map((x, i) => (
            <p key={i} className={x.status === "gebucht" ? "text-ok" : x.status === "doppelt" ? "text-brand" : "text-bad"}>
              {x.status === "gebucht" ? "✓ " : x.status === "doppelt" ? "• " : "! "}
              {x.text}{" "}
              {x.purchaseId && (
                <Link href={`/buchhaltung/ausgaben/${x.purchaseId}`} className="font-medium underline">
                  {x.status === "gebucht" ? "prüfen" : "ansehen"}
                </Link>
              )}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
