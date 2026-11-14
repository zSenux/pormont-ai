import Link from "next/link";
import { ArrowLeft, Euro } from "lucide-react";
import { requireUser } from "@/lib/auth/user";
import { canArea } from "@/lib/rights-shared";
import { formatDate } from "@/lib/berlin";
import { FAMILY_LABEL, MATERIAL_LABEL, STEEL_FAMILIES, STEEL_PROFILES } from "@/lib/steel";
import { steelPrices } from "@/lib/steel-prices";
import { saveSteelPriceForm } from "@/app/actions/stahl";
import { StateForm } from "@/components/state-form";
import { SteelCalculator } from "./calculator";

export const metadata = { title: "Stahl-Katalog" };
export const dynamic = "force-dynamic";

const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export default async function StahlPage() {
  const user = await requireUser();
  const prices = await steelPrices();

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:py-10">
      <div>
        <Link href="/lieferanten" className="flex w-fit items-center gap-1 text-sm text-steel hover:text-brand"><ArrowLeft className="size-4" /> Lieferanten</Link>
        <h1 className="page-title mt-2">Stahl-Materialkatalog</h1>
        <p className="mt-1 text-sm text-steel">
          {STEEL_PROFILES.length} Normprofile, Rohre, Flach-/Rundstahl und Bleche mit Gewicht. Träger nach Normtabelle, der Rest aus der Geometrie – auch Sondermaße. Den Preis rechnet Jarvis aus deinen €/kg-Preisen.
        </p>
      </div>

      <SteelCalculator prices={prices} canStock={canArea(user, "lager")} />

      <section className="card p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Euro className="size-4 text-brand" /> Eigene Einkaufspreise (€ je kg, netto)</h2>
        <p className="mt-1 text-sm text-steel">
          Aus dem letzten Angebot deines Stahlhändlers übernehmen. Leer = kein Preis. Abweichende Preise je Profilart gehen vor dem Grundpreis.
          {prices.stand ? ` Stand ${formatDate(prices.stand)}${prices.quelle ? ` · ${prices.quelle}` : ""}.` : ""}
        </p>
        <StateForm action={saveSteelPriceForm} submit="Preise speichern" className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            {(["STAHL", "EDELSTAHL", "ALU"] as const).map((m) => (
              <label key={m} className="text-xs text-steel">{MATERIAL_LABEL[m]}<input name={m} inputMode="decimal" defaultValue={val(prices[m])} placeholder="€/kg" className="input mt-1 w-full" /></label>
            ))}
            <label className="text-xs text-steel">Zuschlag Verzinken<input name="verzinken" inputMode="decimal" defaultValue={val(prices.verzinken)} placeholder="€/kg" className="input mt-1 w-full" /></label>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-brand">Abweichend je Profilart (Stahl)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {STEEL_FAMILIES.map((f) => (
                <label key={f} className="text-xs text-steel">{FAMILY_LABEL[f]}<input name={`fam_${f}`} inputMode="decimal" defaultValue={val(prices.familien[f])} placeholder="wie Grundpreis" className="input mt-1 w-full" /></label>
              ))}
            </div>
          </details>
          <input name="quelle" defaultValue={prices.quelle ?? ""} placeholder="Quelle, z. B. „Haug, Angebot vom 10.11.2026“" className="input w-full" aria-label="Quelle" />
        </StateForm>
      </section>
    </main>
  );
}
