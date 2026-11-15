import { VoiceQuoteRecorder } from "./recorder";

export const metadata = { title: "Angebot sprechen" };

export default async function AngebotSprache({ searchParams }: { searchParams: Promise<{ projekt?: string }> }) {
  const { projekt } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="page-title">Angebot sprechen</h1>
        <p className="mt-1 text-sm text-steel">Auf der Baustelle ins Handy sagen, was angeboten werden soll: Kunde mit Adresse, Leistungen, Mengen, Preise. Jarvis macht daraus einen Angebots-Entwurf. Preise nimmt Jarvis nur aus deinem Diktat oder dem Artikelstamm – fehlt einer, sagt Jarvis Bescheid.</p>
      </div>
      <VoiceQuoteRecorder projectId={projekt} />
    </div>
  );
}
