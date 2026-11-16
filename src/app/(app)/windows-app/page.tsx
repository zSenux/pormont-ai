import { MonitorDown } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { WindowsAppDownload } from "@/components/windows-app";
import { latestWindowsRelease } from "@/lib/windows-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "Windows-App" };

// Eigene Seite zum Herunterladen der Windows-App (Menü Werkzeuge → Windows-App)
export default async function WindowsAppPage() {
  await requireUser();
  const rel = await latestWindowsRelease();
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <h1 className="page-title">Windows-App</h1>
        <p className="mt-1 text-sm text-steel">Jarvis als eigenes Programm auf dem Windows-PC – aktualisiert sich selbst.</p>
      </div>
      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><MonitorDown className="size-5 text-brand" /> Herunterladen</h2>
        <WindowsAppDownload version={rel?.version ?? null} size={rel?.size ?? null} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-steel">
          <li>Installer herunterladen und öffnen. Meldet Windows „Der Computer wurde geschützt“: „Weitere Informationen“ → „Trotzdem ausführen“.</li>
          <li>Server-Adresse eintragen (die Adresse dieser Seite ohne Pfad) und mit deinem Jarvis-Konto anmelden.</li>
          <li><kbd className="chip border-line bg-mist">Strg + Leertaste</kbd> öffnet Jarvis von überall. Der PC erscheint danach unter „Computer“.</li>
        </ol>
      </section>
    </main>
  );
}
