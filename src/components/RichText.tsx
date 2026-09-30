import { Fragment } from 'react';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

/** Renders plain text with clickable links. Never injects HTML. */
export default function RichText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <span className="rich">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" dir="ltr">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}
