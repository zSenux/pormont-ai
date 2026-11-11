import { Fragment, type ReactNode } from "react";

// Kleiner, sicherer Markdown-Renderer für Jarvis-Antworten: Absätze, Listen, **fett**, `code`, [Links](…).
// Kein HTML aus dem Text – alles wird als React-Text gerendert. Links nur relativ oder https.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={k} className="rounded bg-mist px-1 text-[0.9em]">{m[2]}</code>);
    else {
      const href = m[4];
      const safe = href.startsWith("/") || href.startsWith("https://");
      out.push(
        safe ? (
          <a key={k} href={href} target={href.startsWith("/") && !href.startsWith("/api/") ? undefined : "_blank"} rel="noreferrer">
            {m[3]}
          </a>
        ) : (
          m[3]
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`l${blocks.length}`}>{items}</ol> : <ul key={`l${blocks.length}`}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(l);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    const head = /^#{1,4}\s+(.*)$/.exec(l);
    if (bullet || num) {
      flushPara();
      const ordered = Boolean(num);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (head) {
      flushPara();
      flushList();
      blocks.push(<p key={`h${blocks.length}`} className="font-semibold">{inline(head[1], `h${blocks.length}`)}</p>);
    } else if (!l.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(l);
    }
  }
  flushPara();
  flushList();
  return <div className="prose-jarvis">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
