import "server-only";

// Lexware Office Public API (https://developers.lexware.io/docs/)
// Basis https://api.lexware.io, Bearer-Token = API-Schlüssel aus Lexware Office (Erweiterungen → Öffentliche API).
// Grenze: 2 Anfragen pro Sekunde über alle Endpunkte → Warteschlange mit Abstand + ein Wiederholversuch bei 429.

export const LEXWARE_API = process.env.LEXWARE_API_URL || "https://api.lexware.io";
export const LEXWARE_APP = process.env.LEXWARE_APP_URL || "https://app.lexware.de";

export class LexwareError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "LexwareError";
  }
}

export function lexwareConfigured() {
  return Boolean(process.env.LEXWARE_API_KEY);
}

let chain: Promise<unknown> = Promise.resolve();
let last = 0;
const GAP_MS = 550;

/** Reiht Aufrufe ein, damit nie mehr als ~2 je Sekunde rausgehen (pro Prozess) */
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

function germanError(status: number, body: string) {
  let detail = "";
  try {
    const j = JSON.parse(body) as { message?: string; IssueList?: { i18nKey?: string; source?: string; type?: string }[]; details?: { violation?: string; field?: string; message?: string }[] };
    const issues = j.IssueList?.map((i) => [i.source, i.i18nKey || i.type].filter(Boolean).join(": ")) ?? [];
    const details = j.details?.map((d) => [d.field, d.message || d.violation].filter(Boolean).join(": ")) ?? [];
    detail = [j.message, ...issues, ...details].filter(Boolean).join("; ");
  } catch {
    detail = body.slice(0, 200);
  }
  const base =
    status === 401
      ? "Der Lexware-API-Schlüssel ist ungültig oder abgelaufen."
      : status === 403
        ? "Für diese Aktion fehlt dem Lexware-Schlüssel die Berechtigung."
        : status === 404
          ? "In Lexware nicht gefunden."
          : status === 406 || status === 409
            ? "Lexware kann das in diesem Zustand nicht liefern (z. B. Entwurf ohne PDF)."
            : status === 429
              ? "Lexware bremst gerade (zu viele Anfragen) – bitte gleich noch einmal."
              : `Lexware-Fehler ${status}.`;
  return detail ? `${base} (${detail.slice(0, 300)})` : base;
}

type Opts = { method?: "GET" | "POST" | "PUT"; query?: Record<string, string | number | boolean | undefined | null>; body?: unknown; accept?: string };

async function raw(path: string, opts: Opts = {}): Promise<Response> {
  const key = process.env.LEXWARE_API_KEY;
  if (!key) throw new LexwareError("Lexware ist noch nicht verbunden (LEXWARE_API_KEY fehlt).");
  const url = new URL(path, LEXWARE_API);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const doFetch = () =>
    throttle(() =>
      fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: opts.accept ?? "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      }),
    );
  let res = await doFetch();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await doFetch();
  }
  if (!res.ok) throw new LexwareError(germanError(res.status, await res.text().catch(() => "")), res.status);
  return res;
}

export async function lexGet<T>(path: string, query?: Opts["query"]): Promise<T> {
  return (await raw(path, { query })).json() as Promise<T>;
}

export async function lexPost<T>(path: string, body: unknown, query?: Opts["query"]): Promise<T> {
  return (await raw(path, { method: "POST", body, query })).json() as Promise<T>;
}

/** Binärdatei (PDF) */
export async function lexFile(path: string) {
  const res = await raw(path, { accept: "application/pdf" });
  return { body: res.body, type: res.headers.get("content-type") ?? "application/pdf", disposition: res.headers.get("content-disposition") };
}

/** Datei hochladen (multipart), z. B. Beleg nach /v1/files mit type=voucher */
export async function lexUpload<T>(path: string, form: FormData): Promise<T> {
  const key = process.env.LEXWARE_API_KEY;
  if (!key) throw new LexwareError("Lexware ist noch nicht verbunden (LEXWARE_API_KEY fehlt).");
  const url = new URL(path, LEXWARE_API);
  const send = () => throttle(() => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, body: form, signal: AbortSignal.timeout(60_000), cache: "no-store" }));
  let res = await send();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await send();
  }
  if (!res.ok) throw new LexwareError(germanError(res.status, await res.text().catch(() => "")), res.status);
  return res.json() as Promise<T>;
}

/** Link in die Lexware-Office-Oberfläche */
export function permalink(kind: "invoices" | "quotations" | "contacts" | "credit-notes" | "order-confirmations", id: string, mode: "view" | "edit" = "view") {
  return `${LEXWARE_APP}/permalink/${kind}/${mode}/${id}`;
}
