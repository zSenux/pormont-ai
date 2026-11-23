// Wächter im App-Prozess: meldet hohen Speicher und blockierte Ereignisschleife im Server-Log.
// Kurz vor „Speicher voll“ beendet sich der Prozess geordnet – scripts/start.mjs startet ihn sofort neu
// (besser als ein Absturz mitten in einer Anfrage oder ein Server, der nur noch hängt).
import { getHeapStatistics } from "node:v8";
import { monitorEventLoopDelay } from "node:perf_hooks";

const MB = 1048576;

export function watchProcess() {
  const g = globalThis as { __pmWatch?: boolean };
  if (g.__pmWatch) return;
  g.__pmWatch = true;

  const loop = monitorEventLoopDelay({ resolution: 50 });
  loop.enable();
  let highHeap = 0;

  const timer = setInterval(() => {
    const { used_heap_size, heap_size_limit } = getHeapStatistics();
    const share = used_heap_size / heap_size_limit;
    const rss = Math.round(process.memoryUsage().rss / MB);
    const lagMs = Math.round(loop.percentile(99) / 1e6);
    loop.reset();

    if (lagMs > 2_000) console.warn(`[Wächter] Server war bis zu ${lagMs} ms blockiert (lange Rechnung im Hauptprozess)`);
    if (share > 0.8) {
      highHeap++;
      console.warn(`[Wächter] Speicher hoch: ${Math.round(used_heap_size / MB)} von ${Math.round(heap_size_limit / MB)} MB (RSS ${rss} MB)`);
    } else highHeap = 0;

    // Drei Messungen hintereinander über 92 % → geordneter Neustart, bevor Node mit „heap out of memory“ abstürzt
    if (share > 0.92 && highHeap >= 3 && process.env.PM_SUPERVISED === "1") {
      console.error("[Wächter] Speicher fast voll – App wird neu gestartet");
      process.exit(1);
    }
  }, 60_000);
  timer.unref();
}
