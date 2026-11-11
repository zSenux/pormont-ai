// Jarvis-Reaktor (Idee aus Klaic OS „Ana Live“, in ProMont-Blau): Ringe drehen sich, der Kern pulsiert je nach Zustand
export type ReactorState = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<ReactorState, string> = { idle: "Bereit", listening: "Ich höre zu …", thinking: "Ich denke nach …", speaking: "Ich spreche …" };

export function Reactor({ state, size = 180, onClick }: { state: ReactorState; size?: number; onClick?: () => void }) {
  const ticks = Array.from({ length: 48 }, (_, i) => i);
  return (
    <button type="button" onClick={onClick} className="reactor group relative grid place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-glow/50" data-state={state} style={{ width: size, height: size }} aria-label={`Jarvis – ${LABEL[state]}. Tippen zum Sprechen`}>
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#7dd3fc" />
            <stop offset="70%" stopColor="#0ea5e9" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0f4d83" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="none" stroke="#38bdf8" strokeOpacity=".18" strokeWidth="2" />
        <g className="reactor-ring" style={{ transformOrigin: "100px 100px" }}>
          {ticks.map((i) => (
            <line key={i} x1="100" y1="8" x2="100" y2={i % 4 === 0 ? 20 : 14} stroke="#7dd3fc" strokeOpacity={i % 4 === 0 ? 0.9 : 0.4} strokeWidth="2" transform={`rotate(${i * 7.5} 100 100)`} />
          ))}
        </g>
        <g className="reactor-ring-rev" style={{ transformOrigin: "100px 100px" }}>
          <circle cx="100" cy="100" r="70" fill="none" stroke="#38bdf8" strokeWidth="3" strokeDasharray="40 14 8 14" strokeOpacity=".8" />
        </g>
        <circle cx="100" cy="100" r="54" fill="none" stroke="#0ea5e9" strokeOpacity=".35" strokeWidth="10" />
        <g className="reactor-core" style={{ transformOrigin: "100px 100px" }}>
          <circle cx="100" cy="100" r="46" fill="url(#core)" />
        </g>
      </svg>
      <span className="sr-only">{LABEL[state]}</span>
    </button>
  );
}

export function reactorLabel(s: ReactorState) {
  return LABEL[s];
}
