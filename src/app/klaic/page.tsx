import { KlaicForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Klaic Media · Freischaltung", robots: { index: false, follow: false } };

// Nur für Klaic Media: Jarvis freischalten, befristen oder sperren (im matcher von proxy.ts ausgenommen)
export default function KlaicPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-6">
          <p className="text-xs font-semibold tracking-[0.2em] text-steel uppercase">Klaic Media</p>
          <h1 className="mt-1 text-xl font-bold text-ink">Freischaltung von Jarvis</h1>
          <p className="mb-4 mt-1 text-sm text-steel">Mit dem Klaic-Schlüssel aus dem Hosting (KLAIC_KEY) freischalten, befristen oder sperren.</p>
          <KlaicForm />
        </div>
      </div>
    </main>
  );
}
