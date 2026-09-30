import { Fragment, type ReactNode } from 'react';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

/**
 * Plain text with clickable links and highlighted @mentions. Never injects HTML.
 * `names` are member display names (may contain spaces); the longest match wins.
 */
export default function RichText({ text, names = [], myName }: { text: string; names?: string[]; myName?: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" dir="ltr">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{withMentions(p, names, myName)}</Fragment>
        ),
      )}
    </>
  );
}

function withMentions(text: string, names: string[], myName?: string): ReactNode {
  if (!text.includes('@') || names.length === 0) return text;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const out: ReactNode[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@') {
      const rest = text.slice(i + 1);
      const hit = sorted.find((n) => rest.startsWith(n));
      if (hit) {
        if (buf) out.push(buf);
        buf = '';
        out.push(
          <span key={i} className={`mention ${hit === myName ? 'me' : ''}`}>@{hit}</span>,
        );
        i += hit.length + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push(buf);
  return out;
}
