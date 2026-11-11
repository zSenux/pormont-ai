import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { LoginForm } from "./form";

export const metadata = { title: "Anmelden" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ weiter?: string }> }) {
  if (await currentUser()) redirect("/");
  const { weiter } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-brand-2 to-brand px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-weiss.png" alt="ProMont GmbH" className="mx-auto h-20 w-auto" />
          <p className="mt-2 text-xs font-semibold tracking-[0.25em] text-sky-200 uppercase">Jarvis · KI-Assistent</p>
        </div>
        <div className="card p-6">
          <h1 className="mb-4 text-xl font-bold text-ink">Anmelden</h1>
          <LoginForm weiter={weiter} />
        </div>
        <p className="mt-6 text-center text-xs text-sky-200/80">ProMont GmbH · Metallbau vom Meisterbetrieb · Mannheim</p>
      </div>
    </main>
  );
}
