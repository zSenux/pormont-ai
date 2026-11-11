"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Drucken / als PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-primary" onClick={() => window.print()}>
      <Printer className="size-4" /> {label}
    </button>
  );
}
