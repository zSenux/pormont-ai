// Download der Windows-App: zeigt immer auf den Installer der neuesten GitHub-Release
// (dieselben Releases, aus denen sich die installierte App per electron-updater aktualisiert).
// Öffentliches Repo → direkter Link. Privates Repo → GITHUB_TOKEN setzen, dann leitet der Server
// auf die kurzlebige, signierte Download-Adresse von GitHub weiter (der Token verlässt den Server nicht).

const REPO = () => process.env.WINDOWS_APP_REPO || "zSenux/pormont-ai";
const TTL = 10 * 60_000;

export type WindowsRelease = { version: string; name: string; size: number; url: string; apiUrl: string };

let cache: { at: number; value: WindowsRelease | null } | null = null;

function ghHeaders(accept = "application/vnd.github+json") {
  const h: Record<string, string> = { Accept: accept, "User-Agent": "jarvis-promont", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function latestWindowsRelease(): Promise<WindowsRelease | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  let value: WindowsRelease | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO()}/releases/latest`, { headers: ghHeaders(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const rel = (await res.json()) as { tag_name?: string; assets?: { name: string; size: number; url: string; browser_download_url: string }[] };
      const asset = rel.assets?.find((a) => /\.exe$/i.test(a.name));
      if (asset) value = { version: (rel.tag_name || "").replace(/^v/, ""), name: asset.name, size: asset.size, url: asset.browser_download_url, apiUrl: asset.url };
    } else console.warn("[windows-app] GitHub antwortet", res.status);
  } catch (e) {
    console.warn("[windows-app] GitHub nicht erreichbar:", (e as Error).message);
  }
  // Fehler nur kurz merken, damit es bald erneut versucht wird
  cache = { at: value ? Date.now() : Date.now() - TTL + 60_000, value };
  return value;
}

/** Wohin der Download-Knopf führt. */
export async function windowsDownloadTarget(): Promise<string> {
  if (process.env.WINDOWS_APP_URL) return process.env.WINDOWS_APP_URL;
  const rel = await latestWindowsRelease();
  if (rel && process.env.GITHUB_TOKEN) {
    // Privates Repo: Asset über die API anfragen → GitHub antwortet mit Weiterleitung auf eine signierte Adresse
    try {
      const res = await fetch(rel.apiUrl, { headers: ghHeaders("application/octet-stream"), redirect: "manual", signal: AbortSignal.timeout(8000) });
      const loc = res.headers.get("location");
      if (loc) return loc;
    } catch {}
  }
  if (rel) return rel.url;
  return `https://github.com/${REPO()}/releases/latest`;
}
